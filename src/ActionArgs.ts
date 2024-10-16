export type ActionArgs = {
    autoReleaseTag?: string
    autoReleaseTitle?: string
    isDraft: boolean
    isPreRelease: boolean
    branch: string
}

export function getActionArgs(): ActionArgs {
    const args: ActionArgs = {
        autoReleaseTag: process.env.auto_release_tag,
        autoReleaseTitle: process.env.auto_release_title,
        isDraft: (process.env.is_draft ?? 'false') === 'true',
        isPreRelease: (process.env.is_prerelease ?? 'true') === 'true',
        branch: (process.env.branch ?? 'master'),
    }

    return args
}
