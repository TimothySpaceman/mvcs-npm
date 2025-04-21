import path from "node:path"
import * as process from "process"
import {CONTENT_DIR, FsStorageProvider, Project, PROJECT_DIR} from "../src/index.js"

let uuidCounter = 0
jest.mock("crypto", () => {
    const actualCrypto = jest.requireActual("crypto")
    return {
        ...actualCrypto,
        randomUUID: jest.fn(() => `uuid-${uuidCounter++}`),
    }
})

const tmp = "tests-tmp"
const sp: FsStorageProvider = new FsStorageProvider()

const getProjectFile = async () => {
    const projectFile = await sp.readFile(path.join(PROJECT_DIR, "project.json"))
    const fileContent = (await projectFile.readData()).toString()
    return JSON.parse(fileContent)
}

const getFileContent = async (filePath: string) => {
    const file = await sp.readFile(filePath)
    const fileData = await file.readData()
    return fileData.toString()
}

const shiftTime = function (ms: number) {
    const d = new Date()
    d.setMilliseconds(ms)
    jest.setSystemTime(d)
}

const clearTmp = async () => {
    const files = await sp.readDir(".")
    for (const file of files) {
        await sp.deleteFileOrDir(file)
    }
}

beforeAll(async () => {
    jest
        .useFakeTimers()
        .setSystemTime(new Date("2025-01-01T00:00:00.000Z"))

    if (path.basename(process.cwd()) != tmp) {
        if (!await sp.exists(tmp)) {
            await sp.createDir(tmp)
        }

        process.chdir(tmp)
    }

    await clearTmp()
})

describe("Commits", () => {
    let project: Project

    beforeAll(async () => {
        uuidCounter = 1
        project = await Project.create(
            sp,
            ".",
            "JEST",
            "JEST_PROJECT",
        )
    })

    afterAll(async () => {
        await clearTmp()
    })

    test("Initial", async () => {
        const commitId = "uuid-4"
        const contentPath = "uuid-3"
        const itemId = "uuid-2"

        await sp.createFile("file1.txt", Buffer.from("First line ever"))

        await project.commit(
            await sp.readDir(".", [".mvcs"]),
            "JEST",
            "Initial Commit",
            "First commit in this project"
        )

        await project.save()

        expect(project.currentCommitId).toBe(commitId)

        expect(project.commits[commitId]).toMatchObject({
            "id": commitId,
            "children": [],
            "authorId": "JEST",
            "title": "Initial Commit",
            "description": "First commit in this project",
            "date": "2025-01-01T00:00:00.000Z",
            "changes": [
                {
                    "to": itemId
                }
            ]
        })

        expect(project.items[itemId]).toMatchObject({
            "id": itemId,
            "content": contentPath,
            "path": "file1.txt"
        })

        expect(await getFileContent(path.join(PROJECT_DIR, CONTENT_DIR, contentPath))).toBe("First line ever")

        shiftTime(5000)
    })

    test("Changes", async () => {
        const previousItemId = "uuid-2"
        const newItemId = "uuid-5"
        const newContentId = "uuid-6"
        const newCommitId = "uuid-7"
        const parentCommitId = "uuid-4"

        const file = await sp.readFile("file1.txt")
        await file.writeData(Buffer.from("First line ever\nSecond line"))

        await project.commit(
            await sp.readDir(".", [".mvcs"]),
            "JEST",
            "Modified file1.txt",
        )

        await project.save()

        expect(project.currentCommitId).toBe(newCommitId)
        expect(project.commits[newCommitId]).toMatchObject({
            id: newCommitId,
            parent: parentCommitId,
            children: [],
            authorId: "JEST",
            title: "Modified file1.txt",
            description: "",
            date: "2025-01-01T00:00:05.000Z",
            changes: [{from: previousItemId, to: newItemId}]
        })

        expect(project.items[newItemId]).toMatchObject({
            id: newItemId,
            content: newContentId,
            path: "file1.txt"
        })

        expect(await getFileContent(path.join(PROJECT_DIR, CONTENT_DIR, newContentId)))
            .toBe("First line ever\nSecond line")

        shiftTime(5000)
    })

    test("Subdirs", async () => {
        const newItemId = "uuid-8"
        const newContentId = "uuid-9"
        const newCommitId = "uuid-10"
        const parentCommitId = "uuid-7"

        await sp.createFile("subdir1/file2.txt", Buffer.from("First file in subdir1"))

        await project.commit(
            await sp.readDir(".", [".mvcs"]),
            "JEST",
            "Added subdir1"
        )

        await project.save()

        expect(project.currentCommitId).toBe(newCommitId)

        expect(project.commits[newCommitId]).toMatchObject({
            id: newCommitId,
            parent: parentCommitId,
            children: [],
            authorId: "JEST",
            title: "Added subdir1",
            description: "",
            date: "2025-01-01T00:00:10.000Z",
            changes: [{to: newItemId}]
        })

        expect(project.items[newItemId]).toMatchObject({
            id: newItemId,
            content: newContentId,
            path: "subdir1\\file2.txt"
        })

        expect(await getFileContent(path.join(PROJECT_DIR, CONTENT_DIR, newContentId)))
            .toBe("First file in subdir1")

        shiftTime(5000)
    })

    test("Renamed/Moved Files", async () => {
        const oldItemId = "uuid-5"
        const newItemId = "uuid-11"
        const newContentId = "uuid-6"
        const newCommitId = "uuid-12"
        const parentCommitId = "uuid-10"

        const prevFilesState = await sp.readDir(".", [".mvcs"])

        await sp.moveFile("file1.txt", "subdir1/file1.txt")

        const newFilesState = await sp.readDir(".", [".mvcs"])

        await project.commit(
            [...prevFilesState, ...newFilesState],
            "JEST",
            "Moved file1 into subdir1"
        )

        await project.save()

        expect(project.currentCommitId).toBe(newCommitId)

        expect(project.commits[newCommitId]).toMatchObject({
            id: newCommitId,
            parent: parentCommitId,
            children: [],
            authorId: "JEST",
            title: "Moved file1 into subdir1",
            description: "",
            date: "2025-01-01T00:00:15.000Z",
            changes: [{from: oldItemId}, {to: newItemId}]
        })

        expect(project.items[newItemId]).toMatchObject({
            id: newItemId,
            content: newContentId,
            path: "subdir1\\file1.txt"
        })

        shiftTime(5000)
    })

    test("Copies", async () => {
        const newItemId = "uuid-13"
        const newContentId = "uuid-6"
        const newCommitId = "uuid-14"
        const parentCommitId = "uuid-12"

        await sp.copyFile("subdir1/file1.txt", "file1-copy.txt")

        await project.commit(
            await sp.readDir(".", [".mvcs"]),
            "JEST",
            "Copied file1"
        )

        await project.save()

        expect(project.currentCommitId).toBe(newCommitId)

        expect(project.commits[newCommitId]).toMatchObject({
            id: newCommitId,
            parent: parentCommitId,
            children: [],
            authorId: "JEST",
            title: "Copied file1",
            description: "",
            date: "2025-01-01T00:00:20.000Z",
            changes: [{to: newItemId}]
        })

        expect(project.items[newItemId]).toMatchObject({
            id: newItemId,
            content: newContentId,
            path: "file1-copy.txt"
        })

        shiftTime(5000)
    })

    test("Deletions", async () => {
        const deletedItem1 = "uuid-8"
        const deletedItem2 = "uuid-11"
        const newCommitId = "uuid-15"
        const parentCommitId = "uuid-14"

        const filesToCommit = await sp.readDir(".", [".mvcs"])
        await sp.deleteFileOrDir("subdir1")

        await project.commit(
            filesToCommit,
            "JEST",
            "Removed subdir1"
        )

        await project.save()

        expect(project.currentCommitId).toBe(newCommitId)

        expect(project.commits[newCommitId]).toMatchObject({
            id: newCommitId,
            parent: parentCommitId,
            children: [],
            authorId: "JEST",
            title: "Removed subdir1",
            description: "",
            date: "2025-01-01T00:00:25.000Z",
            changes: [
                {from: deletedItem1},
                {from: deletedItem2}
            ]
        })
    })

    test("Checkout", async () => {
        interface CheckoutTestCase {
            id: string,
            filesList: string[],
            filesToCheck: {
                [fileName: string]: string
            },
        }

        const verifyCheckout = async ({id, filesList, filesToCheck}: CheckoutTestCase) => {
            await project.checkout(id)
            expect(await sp.readDir(".")).toEqual(expect.arrayContaining(filesList))
            for (const [filePath, content] of Object.entries(filesToCheck)) {
                expect(await getFileContent(filePath)).toBe(content)
            }
        }

        const testCases: CheckoutTestCase[] = [
            {
                id: "uuid-4",
                filesList: ["file1.txt", ".mvcs"],
                filesToCheck: {
                    "file1.txt": "First line ever",
                }
            },
            {
                id: "uuid-10",
                filesList: ["file1.txt", "subdir1", "subdir1\\file2.txt", ".mvcs"],
                filesToCheck: {
                    "file1.txt": "First line ever\nSecond line",
                    "subdir1\\file2.txt": "First file in subdir1"
                }
            },
            {
                id: "uuid-15",
                filesList: ["file1-copy.txt", "subdir1", ".mvcs"],
                filesToCheck: {
                    "file1-copy.txt": "First line ever\nSecond line"
                }
            },
            {
                id: "uuid-12",
                filesList: ["subdir1", "subdir1\\file1.txt", "subdir1\\file2.txt", ".mvcs"],
                filesToCheck: {
                    "subdir1\\file1.txt": "First line ever\nSecond line",
                    "subdir1\\file2.txt": "First file in subdir1"
                }
            }
        ]

        for (const testCase of testCases) {
            await verifyCheckout(testCase)
        }
    })
})