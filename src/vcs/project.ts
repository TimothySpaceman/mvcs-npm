import {IStorageProvider} from "../storage/index.js";
import path from "node:path";
import {randomUUID} from "crypto";
import {BranchList, Commit, CommitList, Item, ItemChange, ItemList, Status} from "./types.js";

const PROJECT_DIR = ".mvcs";
const CONTENT_DIR = "contents";
const CONTENT_DUMMY = "DUMMY";

type ProjectDump = {
    id: string;
    authorId: string;
    title: string;
    description?: string;
    branches: BranchList;
    defaultBranch?: string;
    currentBranch?: string;
    commits: CommitList;
    rootCommitId?: string;
    items: ItemList;
};

type ProjectDumpKeys = keyof ProjectDump;

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
    "items",
];

export class Project {
    private sp: IStorageProvider;
    private id = "EMPTY_ID";
    private authorId = "EMPTY_AUTHOR_ID";
    private title = "EMPTY_TITLE";
    private description?: string;
    private workingDir = "EMPTY_WORKING_DIR";
    private branches: BranchList = {};
    private defaultBranch?: string;
    private currentBranch?: string;
    private commits: CommitList = {};
    private rootCommitId?: string;
    private items: ItemList = {};

    private constructor(sp: IStorageProvider, workingDir: string, authorId?: string, title?: string, description?: string) {
        this.sp = sp;
        this.workingDir = path.resolve(workingDir);

        if (authorId && title) {
            this.id = randomUUID();
            this.authorId = authorId;
            this.title = title;
            this.description = description;
        }
    }

    static async fromFile(dirPath: string, sp: IStorageProvider): Promise<Project> {
        const project = new Project(sp, dirPath);
        await project.load();
        return project;
    }

    static async create(
        sp: IStorageProvider,
        workingDir: string,
        authorId: string,
        title: string,
        description?: string
    ): Promise<Project> {
        const project = new Project(sp, workingDir, authorId, title, description);
        await project.save();
        return project;
    }

    private toJSON(): ProjectDump {
        return {
            id: this.id,
            authorId: this.authorId,
            title: this.title,
            description: this.description,
            branches: this.branches,
            currentBranch: this.currentBranch,
            defaultBranch: this.defaultBranch,
            commits: this.commits,
            rootCommitId: this.rootCommitId,
            items: this.items
        };
    }

    private fromJSON(dump: ProjectDump) {
        const keysToImport = PROJECT_DUMP_KEYS.filter(k => Object.keys(dump).includes(k));
        for (const key of keysToImport) {
            (this as any)[key] = dump[key];
        }
    }

    async load() {
        const filePath = path.join(this.workingDir, PROJECT_DIR, "project.json");
        const projectFile = await this.sp.readFile(filePath);
        const projectDump: ProjectDump = JSON.parse((await projectFile.readData()).toString());
        this.fromJSON(projectDump);
    }

    async save() {
        const filePath = path.join(this.workingDir, PROJECT_DIR, "project.json");
        if (!await this.sp.exists(filePath)) {
            await this.sp.createFile(filePath, Buffer.from("{}"))
        }
        const file = await this.sp.readFile(filePath);
        await file.writeData(Buffer.from(JSON.stringify(this.toJSON())));
    }

    getCommitItems(commitId: string): ItemList {
        if (!this.commits[commitId]) {
            throw new Error(`Commit ${commitId} not found in the Commit List`);
        }

        const commitChain = [this.commits[commitId]];
        while (commitChain[0] && commitChain[0].id !== this.rootCommitId) {
            const commit = commitChain[0];
            if (!commit.parent) {
                break;
            }
            const parentCommit = this.commits[commit.parent];
            if (!parentCommit) {
                throw new Error(`Parent commit ${commit.parent} not found in the Commit List`);
            }
            commitChain.unshift(parentCommit)
        }

        const commitItems: ItemList = {};
        for (const commit of commitChain) {
            for (const change of commit.changes) {
                if (change.to) {
                    const itemId = change.to;
                    if (!this.items[itemId]) {
                        throw new Error(`Item ${itemId} not found in the Items List`);
                    }
                    commitItems[itemId] = this.items[itemId];
                }
                if (change.from) {
                    delete commitItems[change.from];
                }
            }
        }

        return commitItems;
    }

    async addContent(sourcePath: string) {
        const file = await this.sp.readFile(sourcePath);
        const contentPath = `${file.name}-${randomUUID()}${file.extension ? "." + file.extension : ""}`;
        await this.sp.copyFile(sourcePath, path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, contentPath));
        return contentPath;
    }

    getLastCommit(): Commit | undefined {
        let lastCommitId: string | undefined = undefined;
        if (Object.keys(this.commits).length > 0 && this.currentBranch) {
            lastCommitId = this.branches[this.currentBranch];
            if (!lastCommitId) {
                throw new Error("Current branch not found in the Branch List");
            }

            if (!this.commits[lastCommitId]) {
                throw new Error("Current branch commit not found in the Commit List");
            }
        }
        return lastCommitId ? this.commits[lastCommitId] : undefined;
    }

    async commit(paths: string[], authorId: string, title: string, description: string = ""): Promise<Commit> {
        const lastCommit = this.getLastCommit();
        let {newItems, changes}: Status = await this.status(paths);
        for (const newItem of Object.values(newItems)) {
            if (newItem.content === CONTENT_DUMMY) {
                newItem.content = await this.addContent(newItem.path);
            }
            this.items[newItem.id] = newItem;
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
        };

        if (Object.keys(this.commits).length === 0) {
            this.rootCommitId = newCommit.id
        }
        this.commits[newCommit.id] = newCommit;

        if (!this.currentBranch) {
            this.currentBranch = "main";
            this.defaultBranch = this.currentBranch;
        }
        this.branches[this.currentBranch] = newCommit.id;

        return newCommit;
    }

    async status(paths: string[] | undefined = undefined): Promise<Status> {
        const createItem = (content: string, path: string): Item => ({
            id: randomUUID(),
            content,
            path
        })

        const lastCommit = this.getLastCommit();
        const lastItems: ItemList = lastCommit ? this.getCommitItems(lastCommit.id) : {};

        if (!paths) {
            const currentPaths = await this.sp.readDirDeep(this.workingDir, [PROJECT_DIR])
            const lastCommitPaths = Object.values(lastItems).map(i => i.path)
            paths = Array.from(new Set([...currentPaths, ...lastCommitPaths]));
        } else {
            paths = Array.from(new Set(paths));
        }

        const newItems: ItemList = {}
        const changes: ItemChange[] = [];

        fileLoop: for (const filePath of paths) {
            if (await this.sp.isDir(filePath)) continue;

            const lastItem = Object.values(lastItems).find(i => i.path === filePath);

            // Removed Files
            if (!await this.sp.exists(filePath)) {
                if (lastItem) changes.push({from: lastItem.id});
                continue;
            }

            const newHash = await (await this.sp.readFile(filePath)).getDataHash();

            // Changed Files
            if (lastItem) {
                const lastContentPath = path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, lastItem.content);
                const lastHash = await (await this.sp.readFile(lastContentPath)).getDataHash();

                if (newHash === lastHash) continue;

                const newItem = createItem(CONTENT_DUMMY, filePath);
                newItems[newItem.id] = newItem;
                changes.push({from: lastItem.id, to: newItem.id});
                continue;
            }

            // Identical (Renamed / Copied / Moved) Files (to avoid redundant content files)
            for (const item of Object.values(lastItems)) {
                const lastContentPath = path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, item.content);
                const lastHash = await (await this.sp.readFile(lastContentPath)).getDataHash();
                if (newHash === lastHash) {
                    const newItem = createItem(item.content, filePath);
                    newItems[newItem.id] = newItem;
                    changes.push({to: newItem.id})
                    continue fileLoop;
                }
            }

            // New Files
            const newItem = createItem(CONTENT_DUMMY, filePath);
            newItems[newItem.id] = newItem;
            changes.push({to: newItem.id});
        }

        return {
            lastItems,
            newItems,
            changes
        }
    }
}
