import * as core from '@actions/core'

export type Args = {
    autoReleaseTag: string
    autoReleaseTitle: string
    isDraft: boolean
    isPreRelease: boolean
    branch: string
}

export function getAndValidateArgs(): Args {
    const args: Args = {
        autoReleaseTag: core.getInput('auto_release_tag'),
        autoReleaseTitle: core.getInput('auto_release_title'),
        isDraft: core.getInput('is_draft') === 'true',
        isPreRelease: core.getInput('is_prerelease') === 'true',
        branch: core.getInput('branch') || 'master',
    }

    return args
}
