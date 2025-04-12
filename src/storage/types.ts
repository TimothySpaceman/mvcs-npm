import {FileHandle} from "fs/promises";

export interface IFile {
    path: string;
    name: string;
    extension: string;
    fullPath: string;
    readData: () => Promise<Buffer>;
    writeData: (data: Buffer) => Promise<void>
    getHandle: () => Promise<FileHandle>;
    getDataHash: (algo?: string) => Promise<string>
}

export interface IStorageProvider {
    exists: (path: string) => Promise<boolean>;
    isFile: (path: string) => Promise<boolean>;
    readFile: (filePath: string) => Promise<IFile>;
    createFile: (filePath: string, content: Buffer) => Promise<IFile>;
    copyFile: (filePath: string, targetPath: string) => Promise<IFile>;
    moveFile: (filePath: string, targetPath: string) => Promise<IFile>;
    isDir: (path: string) => Promise<boolean>;
    readDir: (dirPath: string, ignore?: string[]) => Promise<string[]>;
    readDirDeep: (dirPath: string, ignore?: string[]) => Promise<string[]>;
    createDir: (dirPath: string) => Promise<string>;
    deleteFileOrDir: (dirPath: string) => Promise<void>;
}