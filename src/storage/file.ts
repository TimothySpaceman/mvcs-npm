import fs from "fs";
import path from "node:path";
import {FileHandle} from "fs/promises";
import {IFile} from "./types.js";

export class File implements IFile {
    path: string;
    name: string;
    extension: string;
    fullPath: string; // path + name + extension

    constructor(fullPath: string) {
        this.fullPath = fullPath;
        const parts = fullPath.split(path.sep);
        const fileName = parts.pop();
        if (!fileName) {
            throw new Error("Unable to parse file name")
        }
        this.name = fileName.split(".").slice(0, -1).join("");
        this.extension = fileName?.split(".").pop() ?? "";
        this.path = parts.join(path.sep);
    }

    async readData(): Promise<Buffer> {
        try {
            return await fs.promises.readFile(this.fullPath);
        } catch (err: any) {
            throw new Error(`Failed to read file content: ${err.message}`);
        }
    }

    async writeData(data: Buffer): Promise<void> {
        try {
            return await fs.promises.writeFile(this.fullPath, data);
        } catch (err: any) {
            throw new Error(`Failed to write file content: ${err.message}`);
        }
    }

    async getHandle(): Promise<FileHandle> {
        try {
            return await fs.promises.open(this.fullPath, 'r');
        } catch (err: any) {
            throw new Error(`Failed to open file handle: ${err.message}`);
        }
    }
}