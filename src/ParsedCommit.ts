export enum ConventionalCommitTypes {
    feat = 'Features',
    fix = 'Bug Fixes',
    docs = 'Documentation',
    style = 'Styles',
    refactor = 'Code Refactoring',
    perf = 'Performance Improvements',
    test = 'Tests',
    build = 'Builds',
    ci = 'Continuous Integration',
    chore = 'Chores',
    revert = 'Reverts',
}

export type ParsedCommit = {
    authorName: string
    htmlUrl: string
    sha: string

    type?: string | null
    header?: string | null
    footer?: string | null
    body?: string | null
    scope?: string | null
    subject?: string | null

    pullRequests: Array<{
        number: number
        url: string
    }>
}
