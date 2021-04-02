import * as core from '@actions/core'

export enum ArgName {
    AUTO_RELEASE_TAG = 'auto_release_tag',
    AUTO_RELEASE_TITLE = 'auto_release_title',
    IS_DRAFT = 'is_draft',
    IS_PRERELEASE = 'is_prerelease',
    BRANCH = 'branch',
}

export type IArgs = {
    autoReleaseTag: string
    autoReleaseTitle: string
    isDraft: boolean
    isPreRelease: boolean
    branch: string
}

export function getAndValidateArgs(): IArgs {
    const args: IArgs = {
        autoReleaseTag: core.getInput(ArgName.AUTO_RELEASE_TAG),
        autoReleaseTitle: core.getInput(ArgName.AUTO_RELEASE_TITLE),
        isDraft: core.getInput(ArgName.IS_DRAFT) === 'true',
        isPreRelease: core.getInput(ArgName.IS_PRERELEASE) === 'true',
        branch: core.getInput(ArgName.BRANCH) || 'master',
    }

    return args
}
