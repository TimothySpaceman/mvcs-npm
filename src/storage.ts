import path from "node:path";
import * as fs from "fs";
import {FileHandle} from "fs/promises";

class File {
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

interface DirectoryContent {
    path: string;
    dirs: string[];
    files: string[];
}

interface DirectoryContentDeep {
    path: string;
    dirs: (DirectoryContentDeep | DirectoryContent)[];
    files: string[];
}

interface StorageProvider {
    readFile: (filePath: string) => Promise<File>;
    createFile: (filePath: string, content: Buffer) => Promise<File>;
    copyFile: (filePath: string, targetPath: string) => Promise<File>;
    moveFile: (filePath: string, targetPath: string) => Promise<File>;
    readDirectory: (dirPath: string) => Promise<DirectoryContent>;
    readDirectoryDeep: (dirPath: string, limit?: number, level?: number) => Promise<DirectoryContentDeep | DirectoryContent>;
    createDirectory: (dirPath: string) => Promise<string>;
    deleteFileOrDirectory: (dirPath: string) => Promise<void>;
}

export class FsStorageProvider implements StorageProvider {
    constructor() {
    }

    async readFile(filePath: string): Promise<File> {
        await fs.promises.access(filePath, fs.constants.R_OK);
        return new File(path.resolve(filePath));
    }

    async createFile(filePath: string, content: Buffer): Promise<File> {
        const resolvedPath = path.resolve(filePath);
        const dir = path.dirname(resolvedPath);

        await fs.promises.mkdir(dir, {recursive: true});
        await fs.promises.writeFile(resolvedPath, content);

        return new File(resolvedPath);
    }

    async moveFile(sourcePath: string, targetPath: string): Promise<File> {
        const from = path.resolve(sourcePath);
        const to = path.resolve(targetPath);
        const targetDir = path.dirname(to);
        await fs.promises.mkdir(targetDir, {recursive: true});
        await fs.promises.rename(from, to);
        return new File(to);
    }

    async copyFile(sourcePath: string, targetPath: string): Promise<File> {
        const from = path.resolve(sourcePath);
        const to = path.resolve(targetPath);
        const targetDir = path.dirname(to);
        await fs.promises.mkdir(targetDir, {recursive: true});
        await fs.promises.copyFile(from, to);
        return new File(to);
    }

    async readDirectory(dirPath: string): Promise<DirectoryContent> {
        const items = await fs.promises.readdir(dirPath);

        const result: DirectoryContent = {
            path: dirPath,
            dirs: [],
            files: []
        };

        for (const itemPath of items) {
            const fullPath = path.resolve(path.join(dirPath, itemPath));
            const stats = await fs.promises.stat(fullPath);
            if (stats.isDirectory()) {
                result.dirs.push(fullPath);
            } else if (stats.isFile()) {
                result.files.push(fullPath);
            }
        }

        return result;
    }

    async readDirectoryDeep(dirPath: string, limit: number = 0, level: number = 1): Promise<DirectoryContentDeep | DirectoryContent> {
        if (limit == 1) {
            return this.readDirectory(dirPath);
        }

        const items = await fs.promises.readdir(dirPath);

        const result: DirectoryContentDeep = {
            path: dirPath,
            dirs: [],
            files: []
        };

        for (const itemPath of items) {
            const fullPath = path.resolve(path.join(dirPath, itemPath));
            const stats = await fs.promises.stat(fullPath);
            if (stats.isDirectory()) {
                if ((limit == 0 || level < limit - 1)) {
                    result.dirs.push(await this.readDirectoryDeep(fullPath, limit, level + 1));
                } else {
                    result.dirs.push(await this.readDirectory(fullPath));
                }
            } else if (stats.isFile()) {
                result.files.push(fullPath);
            }
        }

        return result;
    }

    async createDirectory(dirPath: string): Promise<string> {
        const resolvedPath = path.resolve(dirPath);

        await fs.promises.mkdir(resolvedPath, {recursive: true});

        return resolvedPath;
    }

    async deleteFileOrDirectory(path: string): Promise<void> {
        await fs.promises.rm(path, {recursive: true});
    }

}
