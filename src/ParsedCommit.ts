export const ALL_COMMIT_TYPES = [
    {
        key: 'feat',
        label: 'Features',
    },
    {
        key: 'fix',
        label: 'Bug Fixes',
    },
    {
        key: 'docs',
        label: 'Documentation',
    },
    {
        key: 'style',
        label: 'Styles',
    },
    {
        key: 'refactor',
        label: 'Code Refactoring',
    },
    {
        key: 'perf',
        label: 'Performance Improvements',
    },
    {
        key: 'test',
        label: 'Tests',
    },
    {
        key: 'build',
        label: 'Builds',
    },
    {
        key: 'ci',
        label: 'Continuous Integration',
    },
    {
        key: 'chore',
        label: 'Chores',
    },
    {
        key: 'revert',
        label: 'Reverts',
    },
]

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
