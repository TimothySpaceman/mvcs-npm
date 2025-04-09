type Item = {
    id: string; // Item ID
    content: string; // URL for a corresponding file in storage
    path: string; // Local path (including filename)
}

type ItemChange = {
    from?: string; // Previous Item ID
    to?: string; // New Item ID
}

type Commit = {
    id: string; // Commit ID
    parent?: string; // Parent commit ID
    children: string[]; // Children commit IDs
    authorId: string;
    date: string; // Creation Date
    title: string;
    description?: string;
    changes: ItemChange[]; // List of changes in the commit
}

type Branch = {
    title: string;
    lastCommitId: string;
}

type Project = {
    id: string;
    authorId: string;
    title: string;
    description?: string;
    rootCommitId: string; // Root Commit ID
    defaultBranch: string;
    branches: Branch[];
    commits: {
        [key: string]: Commit // Commits list with Commit IDs as keys
    }
}