export type Item = {
    id: string; // Item ID
    content: string; // URL for a corresponding file in storage
    path: string; // Local path (including filename)
}

export type ItemList = {
    [id: string]: Item
}

export type ItemChange = {
    from?: string; // Previous Item ID
    to?: string; // New Item ID
}

export type Commit = {
    id: string; // Commit ID
    parent?: string; // Parent commit ID
    children: string[]; // Children commit IDs
    authorId: string;
    title: string;
    description?: string;
    date: string; // Creation Date
    changes: ItemChange[]; // List of changes in the commit
}

export type CommitList = {
    [id: string]: Commit
}

export type BranchList = {
    [name: string]: string
}