import {FileHandle} from "fs/promises";

export interface IFile {
    path: string;
    name: string;
    extension: string;
    fullPath: string;
    readData: () => Promise<Buffer>;
    writeData: (data: Buffer) => Promise<void>
    getHandle: () => Promise<FileHandle>;

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

export interface IStorageProvider {
    readFile: (filePath: string) => Promise<IFile>;
    createFile: (filePath: string, content: Buffer) => Promise<IFile>;
    copyFile: (filePath: string, targetPath: string) => Promise<IFile>;
    moveFile: (filePath: string, targetPath: string) => Promise<IFile>;
    readDirectory: (dirPath: string) => Promise<DirectoryContent>;
    readDirectoryDeep: (dirPath: string, limit?: number, level?: number) => Promise<DirectoryContentDeep | DirectoryContent>;
    createDirectory: (dirPath: string) => Promise<string>;
    deleteFileOrDirectory: (dirPath: string) => Promise<void>;
}