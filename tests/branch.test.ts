import path from "node:path"
import * as process from "process"
import {FsStorageProvider, Project, PROJECT_DIR} from "../src/index.js"

let uuidCounter = 0
jest.mock("crypto", () => {
    const actualCrypto = jest.requireActual("crypto")
    return {
        ...actualCrypto,
        randomUUID: jest.fn(() => `uuid-${uuidCounter++}`),
    }
})

const tmp = "tests-tmp"
const sp = new FsStorageProvider()

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

describe("Branches", () => {
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

        await sp.createFile("file1.txt", Buffer.from("First line ever"))

        await project.commit(
            await sp.readDir(".", [".mvcs"]),
            "JEST",
            "Initial Commit",
            "First commit in this project"
        )

        await project.save()

        expect(project.branches).toMatchObject({
            "main": commitId
        })
        expect(project.defaultBranch).toBe("main")
        expect(project.currentBranch).toBe("main")
    })

    test("Additional", async () => {
        const commitId = "uuid-4"

        expect(() => {
            project.createBranch("main")
        }).toThrow()

        project.createBranch("dev");
        await project.save()

        expect(project.branches).toMatchObject({
            "dev": commitId,
            "main": commitId
        })
        expect(project.defaultBranch).toBe("main")
        expect(project.currentBranch).toBe("main")
    })

    test("Default", async () => {
        expect(() => {
            project.setDefaultBranch("not-a-branch")
        }).toThrow()

        project.setDefaultBranch("dev")
        await project.save()

        expect(project.defaultBranch).toBe("dev")
    })

    test("Checkout", async () => {
        const mainId = "uuid-4"
        const devId = "uuid-7"

        await expect(async () => {
            await project.checkoutBranch("not-a-branch")
        }).rejects.toThrow()

        await project.checkoutBranch("dev")
        await project.save()

        expect(project.currentBranch).toBe("dev")

        await sp.createFile("dev.txt", Buffer.from("First line ever on dev branch"))
        await project.commit(
            await sp.readDir(".", [".mvcs"]),
            "JEST",
            "Initial Commit",
            "First commit in this project"
        )
        await project.save()

        expect(project.branches).toMatchObject({
            "dev": devId,
            "main": mainId
        })

        expect(project.currentBranch).toBe("dev")
        expect(project.currentCommitId).toBe(devId)

        await project.checkoutBranch("main")
        await project.save()

        expect(project.currentBranch).toBe("main")
        expect(project.currentCommitId).toBe(mainId)
    })

    test("Rename", async () => {
        const mainId = "uuid-4"
        const devId = "uuid-7"

        expect(() => {
            project.renameBranch("not-dev", "renamed-dev")
        }).toThrow()

        expect(() => {
            project.renameBranch("dev", "main")
        }).toThrow()

        project.renameBranch("dev", "renamed-dev")
        await project.save()

        expect(project.branches).toMatchObject({
            "renamed-dev": devId,
            "main": mainId
        })

        project.renameBranch("renamed-dev", "dev")
        await project.save()

        expect(project.branches).toMatchObject({
            "dev": devId,
            "main": mainId
        })
    })

    test("Delete", async () => {
        const mainId = "uuid-4"
        const devId = "uuid-7"

        await project.checkoutBranch("main")

        expect(() => {
            project.deleteBranch("not-a-branch")
        }).toThrow()

        expect(() => {
            project.deleteBranch("main")
        }).toThrow()

        expect(() => {
            project.deleteBranch("dev")
        }).toThrow()

        project.setDefaultBranch("main")
        project.deleteBranch("dev")
        await project.save()

        expect(project.branches).toMatchObject({
            "main": mainId
        })
    })
})