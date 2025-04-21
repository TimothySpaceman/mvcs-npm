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

describe("Projects", () => {
    afterAll(async () => {
        await clearTmp()
    })

    test("Init", async () => {
        const project = await Project.create(
            sp,
            ".",
            "JEST",
            "JEST_PROJECT",
        )

        const fileContent = await getProjectFile()
        expect(fileContent).toMatchObject({
            "id": "uuid-0",
            "authorId": "JEST",
            "title": "JEST_PROJECT",
            "branches": {},
            "commits": {},
            "items": {}
        })
    })

    test("Load", async () => {
        const project = await Project.fromFile(".", sp)

        expect(project.toJSON()).toMatchObject({
            id: "uuid-0",
            authorId: "JEST",
            title: "JEST_PROJECT",
            description: undefined,
            branches: {},
            defaultBranch: undefined,
            currentBranch: undefined,
            commits: {},
            rootCommitId: undefined,
            currentCommitId: undefined,
            items: {}
        })
    })
})