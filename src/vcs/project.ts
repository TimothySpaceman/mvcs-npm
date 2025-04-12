import {IStorageProvider} from "../storage/index.js";
import path from "node:path";
import {randomUUID} from "crypto";
import {BranchList, Commit, CommitList, ItemList} from "./types.js";

const PROJECT_DIR = ".mvcs";
const CONTENT_DIR = "contents";

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
        this.workingDir = workingDir;

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
        Object.assign(this as Object, dump);
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

    async commit(paths: string[], authorId: string, title: string, description: string = ""): Promise<Commit> {
        let lastCommitId: string | undefined = undefined;
        let lastItems: ItemList = {};
        if (Object.keys(this.commits).length > 0 && this.currentBranch) {
            lastCommitId = this.branches[this.currentBranch];
            if (!lastCommitId) {
                throw new Error("Current branch not found in the Branch List");
            }

            if (!this.commits[lastCommitId]) {
                throw new Error("Current branch commit not found in the Commit List");
            }

            lastItems = this.getCommitItems(lastCommitId);
        }

        const newCommit: Commit = {
            id: randomUUID(),
            parent: lastCommitId,
            children: [],
            authorId,
            title,
            description,
            date: (new Date()).toISOString(),
            changes: []
        };

        for (const filePath of paths) {
            if (await this.sp.isDir(filePath)) continue;

            const lastItem = Object.values(lastItems).find(i => i.path === filePath)
            if (lastItem) {
                const lastContent = await this.sp.readFile(path.join(this.workingDir, PROJECT_DIR, CONTENT_DIR, lastItem.content));
                const lastHash = await lastContent.getDataHash();
                const newHash = await (await this.sp.readFile(filePath)).getDataHash();
                if (newHash === lastHash) {
                    continue;
                }

                const newItem = {
                    id: randomUUID(),
                    content: await this.addContent(filePath),
                    path: filePath
                }

                this.items[newItem.id] = newItem;
                newCommit.changes.push({from: lastItem.id, to: newItem.id});
            } else {
                const newItem = {
                    id: randomUUID(),
                    content: await this.addContent(filePath),
                    path: filePath
                }

                this.items[newItem.id] = newItem;
                newCommit.changes.push({to: newItem.id});
            }
        }

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
}
