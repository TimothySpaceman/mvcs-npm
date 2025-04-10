import {IStorageProvider} from "../storage/index.js";
import path from "node:path";
import * as crypto from "crypto";

const PROJECT_DIRNAME = ".mvcs";

type ProjectDump = {
    id: string;
    authorId: string;
    title: string;
    description?: string;
    rootCommitId?: string;
    defaultBranch?: string;
    commits: any[];
};

type ProjectDumpKeys = keyof ProjectDump;

export class Project {
    private sp: IStorageProvider;
    private _id = "EMPTY_ID";
    private _authorId = "EMPTY_AUTHOR_ID";
    private _title = "EMPTY_TITLE";
    private _description?: string;
    private _workingDir = "EMPTY_WORKING_DIR";
    private _rootCommitId?: string;
    private _defaultBranch?: string;
    private _commits: any[] = [];

    private constructor(sp: IStorageProvider, workingDir: string, authorId?: string, title?: string, description?: string) {
        this.sp = sp;
        this._workingDir = workingDir;

        if (authorId && title) {
            this._id = crypto.randomUUID();
            this._authorId = authorId;
            this._title = title;
            this._description = description;
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

    private async updateAndSave<T extends keyof ProjectDump>(key: T, value: ProjectDump[T]) {
        (this as any)[`_${key}`] = value;
        await this.save();
    }

    get id() {
        return this._id;
    }

    set id(value) {
        this.updateAndSave("id", value);
    }

    get authorId() {
        return this._authorId;
    }

    set authorId(value) {
        this.updateAndSave("authorId", value);
    }

    get title() {
        return this._title;
    }

    set title(value) {
        this.updateAndSave("title", value);
    }

    get description() {
        return this._description;
    }

    set description(value) {
        this.updateAndSave("description", value);
    }

    get workingDir() {
        return this._workingDir;
    }

    set workingDir(value) {
        this.updateAndSave("workingDir" as any, value);
    }

    get rootCommitId() {
        return this._rootCommitId;
    }

    set rootCommitId(value) {
        this.updateAndSave("rootCommitId", value);
    }

    get defaultBranch() {
        return this._defaultBranch;
    }

    set defaultBranch(value) {
        this.updateAndSave("defaultBranch", value);
    }

    get commits() {
        return this._commits;
    }

    set commits(value) {
        this._commits = value;
    }

    async load() {
        const filePath = path.join(this._workingDir, PROJECT_DIRNAME, "project.json");
        const projectFile = await this.sp.readFile(filePath);
        const projectDump: ProjectDump = JSON.parse((await projectFile.readData()).toString());

        const fields: ProjectDumpKeys[] = [
            "id",
            "authorId",
            "title",
            "description",
            "rootCommitId",
            "defaultBranch",
            "commits"
        ];

        for (const key of fields) {
            (this as any)[`_${key}`] = projectDump[key];
        }
    }

    async save() {
        const filePath = path.join(this._workingDir, PROJECT_DIRNAME, "project.json");
        const file = await this.sp.readFile(filePath);

        const dump: ProjectDump = {
            id: this._id,
            authorId: this._authorId,
            title: this._title,
            description: this._description,
            rootCommitId: this._rootCommitId,
            defaultBranch: this._defaultBranch,
            commits: this._commits,
        };

        await file.writeData(Buffer.from(JSON.stringify(dump)));
    }
}
