import {IStorageProvider} from "./types.js";
import {File} from "./file.js";
import fs from "fs";
import path from "node:path";
import {glob} from "glob";

export class FsStorageProvider implements IStorageProvider {
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

    async readDir(dirPath: string, ignore: string[] = []): Promise<string[]> {
        return await glob.glob("*", {cwd: dirPath, ignore, noext: false});
    }

    async readDirDeep(dirPath: string, ignore: string[] = []): Promise<string[]> {
        return await glob.glob("**/*", {cwd: dirPath, ignore, noext: false});
    }

    async createDir(dirPath: string): Promise<string> {
        const resolvedPath = path.resolve(dirPath);

        await fs.promises.mkdir(resolvedPath, {recursive: true});

        return resolvedPath;
    }

    async deleteFileOrDir(path: string): Promise<void> {
        await fs.promises.rm(path, {recursive: true});
    }

}