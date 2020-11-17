import * as core from '@actions/core'

export type Args = {
    autoReleaseTag: string
    autoReleaseTitle: string
    isDraft: boolean
    isPreRelease: boolean
}

export function getAndValidateArgs(): Args {
    const args: Args = {
        autoReleaseTag: core.getInput('auto_release_tag'),
        autoReleaseTitle: core.getInput('auto_release_title'),
        isDraft: JSON.parse(core.getInput('is_draft')) as boolean,
        isPreRelease: JSON.parse(core.getInput('is_prerelease')) as boolean,
    }

    return args
}
