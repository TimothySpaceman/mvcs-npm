import fs from "fs";
import path from "node:path";
import {FileHandle} from "fs/promises";

export class File {
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

    async readContent(): Promise<Buffer> {
        try {
            return await fs.promises.readFile(this.fullPath);
        } catch (err: any) {
            throw new Error(`Failed to read file content: ${err.message}`);
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

export interface DirectoryContent {
    path: string;
    dirs: string[];
    files: string[];
}

export interface DirectoryContentDeep {
    path: string;
    dirs: (DirectoryContentDeep | DirectoryContent)[];
    files: string[];
}

export interface StorageProvider {
    readFile: (filePath: string) => Promise<File>;
    createFile: (filePath: string, content: Buffer) => Promise<File>;
    copyFile: (filePath: string, targetPath: string) => Promise<File>;
    moveFile: (filePath: string, targetPath: string) => Promise<File>;
    readDirectory: (dirPath: string) => Promise<DirectoryContent>;
    readDirectoryDeep: (dirPath: string, limit?: number, level?: number) => Promise<DirectoryContentDeep | DirectoryContent>;
    createDirectory: (dirPath: string) => Promise<string>;
    deleteFileOrDirectory: (dirPath: string) => Promise<void>;
}