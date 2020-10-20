import * as core from '@actions/core'

export type Args = {
    releaseTitle: string
    automaticReleaseTag: string
    isDraft: boolean
    isPreRelease: boolean
}

export function getAndValidateArgs(): Args {
    const args: Args = {
        releaseTitle: core.getInput('title', { required: false }),
        automaticReleaseTag: core.getInput('automatic_release_tag', { required: false }),
        isDraft: JSON.parse(core.getInput('is_draft', { required: true })) as boolean,
        isPreRelease: JSON.parse(core.getInput('is_prerelease', { required: true })) as boolean,
    }

    return args
}
