import {IStorageProvider} from "../storage/index.js"
import path from "node:path"
import {randomUUID} from "crypto"
import {BranchList, Commit, CommitList, Item, ItemChange, ItemList, Status} from "./types.js"

export const PROJECT_DIR = ".mvcs"
export const CONTENT_DIR = "contents"
const CONTENT_DUMMY = "DUMMY"

type ProjectDump = {
    id: string
    authorId: string
    title: string
    description?: string
    branches: BranchList
    defaultBranch?: string
    currentBranch?: string
    commits: CommitList
    rootCommitId?: string
    currentCommitId?: string
    items: ItemList
}

type ProjectDumpKeys = keyof ProjectDump

const PROJECT_DUMP_KEYS: ProjectDumpKeys[] = [
    "id",
    "authorId",
    "title",
    "description",
    "branches",
    "defaultBranch",
    "currentBranch",
    "commits",
    "rootCommitId",
    "currentCommitId",
    "items",
]

export class Project {
    sp: IStorageProvider
    id = "EMPTY_ID"
    authorId = "EMPTY_AUTHOR_ID"
    title = "EMPTY_TITLE"
    description?: string
    workingDir = "EMPTY_WORKING_DIR"
    branches: BranchList = {}
    defaultBranch?: string
    currentBranch?: string
    commits: CommitList = {}
    rootCommitId?: string
    currentCommitId?: string
    items: ItemList = {}

    private constructor(sp: IStorageProvider, workingDir: string, authorId?: string, title?: string, description?: string) {
        this.sp = sp
        this.workingDir = path.resolve(workingDir)

        if (authorId && title) {
            this.id = randomUUID()
            this.authorId = authorId
            this.title = title
            this.description = description
        }
    }

    static async fromFile(dirPath: string, sp: IStorageProvider): Promise<Project> {
        const project = new Project(sp, dirPath)
        await project.load()
        return project
    }

    static async create(
        sp: IStorageProvider,
        workingDir: string,
        authorId: string,
        title: string,
        description?: string
    ): Promise<Project> {
        const project = new Project(sp, workingDir, authorId, title, description)
        await project.save()
        return project
    }

    toJSON(): ProjectDump {
        return {
            id: this.id,
            authorId: this.authorId,
            title: this.title,
            description: this.description,
            branches: this.branches,
            defaultBranch: this.defaultBranch,
            currentBranch: this.currentBranch,
            commits: this.commits,
            rootCommitId: this.rootCommitId,
            currentCommitId: this.currentCommitId,
            items: this.items
        }
    }

    fromJSON(dump: ProjectDump) {
        const keysToImport = PROJECT_DUMP_KEYS.filter(k => Object.keys(dump).includes(k))
        for (const key of keysToImport) {
            (this as any)[key] = dump[key]
        }
    }

    async load() {
        const filePath = path.join(this.workingDir, PROJECT_DIR, "project.json")
        const projectFile = await this.sp.readFile(filePath)
        const projectDump: ProjectDump = JSON.parse((await projectFile.readData()).toString())
        this.fromJSON(projectDump)
    }

    async save() {
        const filePath = path.join(this.workingDir, PROJECT_DIR, "project.json")
        if (!await this.sp.exists(filePath)) {
            await this.sp.createFile(filePath, Buffer.from("{}"))
        }
        const file = await this.sp.readFile(filePath)
        await file.writeData(Buffer.from(JSON.stringify(this.toJSON())))
    }

    async addContent(sourcePath: string) {
        const file = await this.sp.readFile(sourcePath)
        const contentPath = randomUUID()
        await this.sp.copyFile(sourcePath, path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, contentPath))
        return contentPath
    }

    matchCommitId(idPart: string): string {
        if (idPart.length < 6) {
            throw new Error("You must specify at least 6 symbols of ID")
        }
        const candidates = Object.keys(this.commits).filter(id => id.startsWith(idPart))
        if (candidates.length === 0) {
            throw new Error(`No ID candidate for ${idPart} found`)
        }
        if (candidates.length > 1) {
            throw new Error(`Multiple ID candidates were found for ${idPart}`)
        }
        return candidates.pop() as string
    }

    getCurrentCommit(): Commit | undefined {
        let currentCommitId: string | undefined = this.currentCommitId

        if (!currentCommitId && Object.keys(this.commits).length > 0) {
            throw new Error("No current commit")
        }

        if (currentCommitId && !this.commits[currentCommitId]) {
            throw new Error("Current commit not found in the Commit List")
        }

        return currentCommitId ? this.commits[currentCommitId] : undefined
    }

    getCommitItems(commitId: string): ItemList {
        commitId = this.matchCommitId(commitId)
        const targetCommit = this.commits[commitId]
        if (!targetCommit) {
            throw new Error(`Commit ${commitId} not found in the Commit List`)
        }

        const commitChain: Commit[] = [targetCommit]
        while (commitChain[0] && commitChain[0].id !== this.rootCommitId) {
            const commit = commitChain[0]
            if (!commit.parent) {
                break
            }
            const parentCommit = this.commits[commit.parent]
            if (!parentCommit) {
                throw new Error(`Parent commit ${commit.parent} not found in the Commit List`)
            }
            commitChain.unshift(parentCommit)
        }

        const commitItems: ItemList = {}
        for (const commit of commitChain) {
            for (const change of commit.changes) {
                if (change.to) {
                    const itemId = change.to
                    if (!this.items[itemId]) {
                        throw new Error(`Item ${itemId} not found in the Items List`)
                    }
                    commitItems[itemId] = this.items[itemId]
                }
                if (change.from) {
                    delete commitItems[change.from]
                }
            }
        }

        return commitItems
    }

    async status(files: string[] | undefined = undefined): Promise<Status> {
        const createItem = (content: string, path: string): Item => ({
            id: randomUUID(),
            content,
            path
        })

        const lastCommit = this.getCurrentCommit()
        const lastItems: ItemList = lastCommit ? this.getCommitItems(lastCommit.id) : {}


        if (!files) {
            const currentFiles = await this.sp.readDirDeep(this.workingDir, [`${PROJECT_DIR}/**`])
            const lastCommitFiles = Object.values(lastItems).map(i => i.path)
            files = Array.from(new Set([...currentFiles, ...lastCommitFiles]))
        } else {
            files = Array.from(new Set(files))
        }

        const newItems: ItemList = {}
        const changes: ItemChange[] = []

        fileLoop: for (const filePath of files) {
            if (await this.sp.isDir(filePath)) continue

            const lastItem = Object.values(lastItems).find(i => i.path === filePath)

            // Removed Files
            if (!await this.sp.exists(filePath)) {
                if (lastItem) changes.push({from: lastItem.id})
                continue
            }

            const newHash = await (await this.sp.readFile(filePath)).getDataHash()

            // Changed Files
            if (lastItem) {
                const lastContentPath = path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, lastItem.content)
                const lastHash = await (await this.sp.readFile(lastContentPath)).getDataHash()

                if (newHash === lastHash) continue

                const newItem = createItem(CONTENT_DUMMY, filePath)
                newItems[newItem.id] = newItem
                changes.push({from: lastItem.id, to: newItem.id})
                continue
            }

            // Identical (Renamed / Copied / Moved) Files (to avoid redundant content files)
            for (const item of Object.values(lastItems)) {
                const lastContentPath = path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, item.content)
                const lastHash = await (await this.sp.readFile(lastContentPath)).getDataHash()
                if (newHash === lastHash) {
                    const newItem = createItem(item.content, filePath)
                    newItems[newItem.id] = newItem
                    changes.push({to: newItem.id})
                    continue fileLoop
                }
            }

            // New Files
            const newItem = createItem(CONTENT_DUMMY, filePath)
            newItems[newItem.id] = newItem
            changes.push({to: newItem.id})
        }

        return {
            lastItems,
            newItems,
            changes
        }
    }

    async commit(files: string[], authorId: string, title: string, description: string = ""): Promise<Commit> {
        if (
            !this.currentBranch ||
            !this.branches[this.currentBranch] ||
            this.branches[this.currentBranch] !== this.currentCommitId
        ) {
            if (Object.keys(this.commits).length > 0) {
                throw new Error("Cannot commit when not at the branch")
            }
        }

        const lastCommit = this.getCurrentCommit()
        let {newItems, changes}: Status = await this.status(files)
        for (const newItem of Object.values(newItems)) {
            if (newItem.content === CONTENT_DUMMY) {
                newItem.content = await this.addContent(newItem.path)
            }
            this.items[newItem.id] = newItem
        }

        const newCommit: Commit = {
            id: randomUUID(),
            parent: lastCommit?.id,
            children: [],
            authorId,
            title,
            description,
            date: (new Date()).toISOString(),
            changes
        }

        if (Object.keys(this.commits).length === 0) {
            this.rootCommitId = newCommit.id
            this.currentBranch = this.currentBranch ?? "main"
            this.defaultBranch = this.currentBranch
        }
        this.commits[newCommit.id] = newCommit
        this.branches[this.currentBranch as string] = newCommit.id
        this.currentCommitId = newCommit.id

        return newCommit
    }

    async checkout(commitId: string) {
        commitId = this.matchCommitId(commitId)
        const commitItems = this.getCommitItems(commitId)

        const currentFilesAndDirs = await this.sp.readDirDeep(this.workingDir, [`${PROJECT_DIR}/**`])
        const currentFiles: string[] = []
        await Promise.all(currentFilesAndDirs.map(async p => {
            if (await this.sp.isFile(p)) {
                currentFiles.push(p)
            }
        }))
        const commitFiles = Object.values(commitItems).map(i => i.path)

        for (const filePath of currentFiles) {
            if (!commitFiles.includes(filePath)) {
                await this.sp.deleteFileOrDir(filePath)
            }
        }

        for (const item of Object.values(commitItems)) {
            const itemContentPath = path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, item.content)
            const itemContent = await this.sp.readFile(itemContentPath)
            const itemHash = await itemContent.getDataHash()

            if (currentFiles.includes(item.path)) {
                const currentContent = await this.sp.readFile(item.path)
                const currentHash = await currentContent.getDataHash()
                if (itemHash === currentHash) continue
            }

            await this.sp.copyFile(itemContentPath, item.path)
        }

        this.currentCommitId = commitId
    }

    async checkoutBranch(branchName: string) {
        this.throwIfBranchNotFound(branchName)
        const branchCommit = this.branches[branchName] as string
        if (!this.commits[branchCommit]) {
            throw new Error(`Commit ${branchCommit} (branch ${branchName}) not found`)
        }
        await this.checkout(branchCommit)
        this.currentBranch = branchName
    }

    createBranch(branchName: string) {
        if (!this.currentCommitId && Object.keys(this.commits).length > 0) {
            throw new Error("No current commit")
        }
        this.throwIfBranchFound(branchName)
        this.branches[branchName] = this.currentCommitId as string
        if (!this.defaultBranch) {
            this.defaultBranch = branchName
        }
    }

    deleteBranch(branchName: string) {
        this.throwIfBranchNotFound(branchName)
        if (Object.keys(this.branches).length === 1) {
            throw new Error(`Cannot delete the only branch in the project`)
        }
        if (this.currentBranch === branchName) {
            throw new Error(`Cannot delete the branch you"re currently on`)
        }
        if (this.defaultBranch === branchName) {
            throw new Error(`Cannot delete default branch`)
        }
        delete this.branches[branchName]
    }

    renameBranch(oldName: string, newName: string) {
        this.throwIfBranchNotFound(oldName)
        this.throwIfBranchFound(newName)
        this.branches[newName] = this.branches[oldName] as string
        if (this.currentBranch === oldName) {
            this.currentBranch = newName
        }
        delete this.branches[oldName]
    }

    setDefaultBranch(branchName: string) {
        this.throwIfBranchNotFound(branchName)
        this.defaultBranch = branchName
    }

    throwIfBranchNotFound(branchName: string) {
        if (!this.branches[branchName]) {
            throw new Error(`Branch ${branchName} not found`)
        }
    }

    throwIfBranchFound(branchName: string) {
        if (this.branches[branchName]) {
            throw new Error(`Branch ${branchName} already exists`)
        }
    }
}
