import {File, StorageProvider, DirectoryContent, DirectoryContentDeep} from "./types.js";
import fs from "fs";
import path from "node:path";

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