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
    branches: { [k: string]: string }
    defaultBranch?: string
    currentBranch?: string
    commits: { [k: string]: Commit }
    rootCommitId?: string
    currentCommitId?: string
    items: { [k: string]: Item }
}

type ProjectDumpKey = keyof ProjectDump

const PROJECT_DUMP_KEYS: ProjectDumpKey[] = [
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
    branches: BranchList = new Map<string, string>()
    defaultBranch?: string
    currentBranch?: string
    commits: CommitList = new Map<string, Commit>()
    rootCommitId?: string
    currentCommitId?: string
    items: ItemList = new Map<string, Item>()

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
            branches: Object.fromEntries(this.branches),
            defaultBranch: this.defaultBranch,
            currentBranch: this.currentBranch,
            commits: Object.fromEntries(this.commits),
            rootCommitId: this.rootCommitId,
            currentCommitId: this.currentCommitId,
            items: Object.fromEntries(this.items)
        }
    }

    fromJSON(dump: ProjectDump) {
        const keysToImport = PROJECT_DUMP_KEYS.filter(k => k in dump)
        const mapNames = ["branches", "commits", "items"]
        const mapsToImport = keysToImport.filter(k => mapNames.includes(k))
        for (const key of keysToImport.filter(k => !mapsToImport.includes(k))) {
            (this as any)[key] = dump[key]
        }
        for (const mapName of mapsToImport) {
            (this as any)[mapName] = new Map(Object.entries(dump[mapName] as any))
        }
    }

    async load() {
        const filePath = this.getProjectFilePath();
        const projectFile = await this.sp.readFile(filePath)
        const projectDump: ProjectDump = JSON.parse((await projectFile.readData()).toString())
        this.fromJSON(projectDump)
    }

    async save() {
        const filePath = this.getProjectFilePath();
        if (!await this.sp.exists(filePath)) {
            await this.sp.createFile(filePath, Buffer.from("{}"))
        }
        const file = await this.sp.readFile(filePath)
        await file.writeData(Buffer.from(JSON.stringify(this.toJSON())))
    }

    getProjectFilePath(): string {
        return path.join(this.workingDir, PROJECT_DIR, "project.json");
    }

    async addContent(sourcePath: string): Promise<string> {
        const file = await this.sp.readFile(sourcePath)
        const hash = await file.getDataHash()

        for (const item of this.items.values()) {
            const candidatePath = path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, item.content)
            const candidateHash = await (await this.sp.readFile(candidatePath)).getDataHash()
            if (candidateHash === hash) {
                return item.content
            }
        }

        const contentPath = randomUUID()
        await this.sp.copyFile(sourcePath, path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, contentPath))
        return contentPath
    }

    matchCommitId(idPart: string): string {
        if (idPart.length < 7) {
            throw new Error("You must specify at least 7 symbols of ID")
        }
        const candidates = [...this.commits.keys()].filter(id => id.startsWith(idPart))
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

        if (!currentCommitId && this.commits.size > 0) {
            throw new Error("No current commit")
        }

        if (currentCommitId && !this.commits.has(currentCommitId)) {
            throw new Error("Current commit not found in the Commit List")
        }

        return currentCommitId ? this.commits.get(currentCommitId) : undefined
    }

    getCommitItems(commitId: string): ItemList {
        commitId = this.matchCommitId(commitId)
        const targetCommit = this.commits.get(commitId)
        if (!targetCommit) {
            throw new Error(`Commit ${commitId} not found in the Commit List`)
        }

        const commitChain = this.buildCommitChain(targetCommit);

        const commitItems: ItemList = new Map<string, Item>()
        for (const commit of commitChain) {
            this.applyCommitChanges(commit, commitItems);
        }

        return commitItems
    }

    buildCommitChain(targetCommit: Commit): Commit[] {
        const commitChain: Commit[] = [targetCommit]

        while (commitChain[0] && commitChain[0].id !== this.rootCommitId) {
            const commit = commitChain[0]
            if (!commit.parent) {
                break
            }

            const parentCommit = this.commits.get(commit.parent)
            if (!parentCommit) {
                throw new Error(`Parent commit ${commit.parent} not found in the Commit List`)
            }

            commitChain.unshift(parentCommit)
        }

        return commitChain;
    }

    applyCommitChanges(commit: Commit, resultItems: ItemList): void {
        for (const change of commit.changes) {
            if (change.to) {
                const itemId = change.to
                if (!this.items.has(itemId)) {
                    throw new Error(`Item ${itemId} not found in the Items List`)
                }
                resultItems.set(itemId, this.items.get(itemId) as Item)
            }
            if (change.from) {
                resultItems.delete(change.from)
            }
        }
    }

    async getCurrentFiles(): Promise<string[]> {
        const currentFilesAndDirs = await this.sp.readDirDeep(this.workingDir, [`${PROJECT_DIR}/**`])
        const currentFiles: string[] = []

        await Promise.all(currentFilesAndDirs.map(async p => {
            if (await this.sp.isFile(p)) {
                currentFiles.push(p)
            }
        }))

        return currentFiles;
    }

    async status(files: string[] | undefined = undefined): Promise<Status> {
        const createItem = (content: string, path: string): Item => ({
            id: randomUUID(),
            content,
            path
        })

        const lastCommit = this.getCurrentCommit()
        const lastItems: ItemList = lastCommit ? this.getCommitItems(lastCommit.id) : new Map<string, Item>()

        if (!files) {
            const currentFiles = await this.getCurrentFiles()
            const lastCommitFiles = [...lastItems.values()].map(i => i.path)
            files = [...currentFiles, ...lastCommitFiles]
        }
        files = Array.from(new Set(files))

        const newItems: ItemList = new Map<string, Item>()
        const changes: ItemChange[] = []

        for (const filePath of files) {
            if (await this.sp.isDir(filePath)) continue

            const lastItem = [...lastItems.values()].find(i => i.path === filePath)

            // Removed Files
            if (!await this.sp.exists(filePath)) {
                if (lastItem) changes.push({from: lastItem.id})
                continue
            }

            let from = undefined

            // Changed Files
            const newHash = await (await this.sp.readFile(filePath)).getDataHash()
            if (lastItem) {
                const lastContentPath = path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, lastItem.content)
                const lastHash = await (await this.sp.readFile(lastContentPath)).getDataHash()

                if (newHash === lastHash) continue;
                from = lastItem.id
            }

            // New Files
            const newItem = createItem(CONTENT_DUMMY, filePath)
            newItems.set(newItem.id, newItem)
            changes.push({from, to: newItem.id})
        }

        return {
            lastItems,
            newItems,
            changes
        }
    }

    async commit(files: string[], authorId: string, title: string, description: string = ""): Promise<Commit> {
        this.ensureValidBranchForCommit()

        const {newItems, changes}: Status = await this.status(files)
        for (const newItem of newItems.values()) {
            if (newItem.content === CONTENT_DUMMY) {
                newItem.content = await this.addContent(newItem.path)
            }
            this.items.set(newItem.id, newItem)
        }

        const newCommit: Commit = {
            id: randomUUID(),
            parent: this.getCurrentCommit()?.id,
            children: [],
            authorId,
            title,
            description,
            date: (new Date()).toISOString(),
            changes
        }

        if (this.commits.size === 0) {
            this.rootCommitId = newCommit.id
            this.currentBranch = this.currentBranch ?? "main"
            this.defaultBranch = this.currentBranch
        }
        this.commits.set(newCommit.id, newCommit)
        this.branches.set(this.currentBranch as string, newCommit.id)
        this.currentCommitId = newCommit.id

        return newCommit
    }

    ensureValidBranchForCommit(): void {
        if (this.commits.size === 0) return;

        const err = new Error("Cannot commit when not at the branch")

        if (!this.currentBranch) {
            throw err
        }
        if (!this.branches.has(this.currentBranch)) {
            throw err
        }
        if (this.branches.get(this.currentBranch) !== this.currentCommitId) {
            throw err
        }
    }

    async checkout(commitId: string) {
        commitId = this.matchCommitId(commitId)
        const commitItems = this.getCommitItems(commitId)

        const currentFiles: string[] = await this.getCurrentFiles()
        const commitFiles = [...commitItems.values()].map(i => i.path)

        for (const filePath of currentFiles) {
            if (!commitFiles.includes(filePath)) {
                await this.sp.deleteFileOrDir(filePath)
            }
        }

        for (const item of commitItems.values()) {
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
        const branchCommit = this.branches.get(branchName) as string
        if (!this.commits.has(branchCommit)) {
            throw new Error(`Commit ${branchCommit} (branch ${branchName}) not found`)
        }
        await this.checkout(branchCommit)
        this.currentBranch = branchName
    }

    createBranch(branchName: string) {
        if (!this.currentCommitId && this.commits.size > 0) {
            throw new Error("No current commit")
        }
        this.throwIfBranchFound(branchName)
        this.branches.set(branchName, this.currentCommitId as string)
        if (!this.defaultBranch) {
            this.defaultBranch = branchName
        }
    }

    deleteBranch(branchName: string) {
        this.throwIfBranchNotFound(branchName)
        if (this.branches.size === 1) {
            throw new Error(`Cannot delete the only branch in the project`)
        }
        if (this.currentBranch === branchName) {
            throw new Error(`Cannot delete the branch you"re currently on`)
        }
        if (this.defaultBranch === branchName) {
            throw new Error(`Cannot delete default branch`)
        }
        this.branches.delete(branchName)
    }

    renameBranch(oldName: string, newName: string) {
        this.throwIfBranchNotFound(oldName)
        this.throwIfBranchFound(newName)
        this.branches.set(newName, this.branches.get(oldName) as string)
        if (this.currentBranch === oldName) {
            this.currentBranch = newName
        }
        if (this.defaultBranch === oldName) {
            this.defaultBranch = newName
        }
        this.branches.delete(oldName)
    }

    setDefaultBranch(branchName: string) {
        this.throwIfBranchNotFound(branchName)
        this.defaultBranch = branchName
    }

    throwIfBranchNotFound(branchName: string) {
        if (!this.branches.has(branchName)) {
            throw new Error(`Branch ${branchName} not found`)
        }
    }

    throwIfBranchFound(branchName: string) {
        if (this.branches.has(branchName)) {
            throw new Error(`Branch ${branchName} already exists`)
        }
    }
}
