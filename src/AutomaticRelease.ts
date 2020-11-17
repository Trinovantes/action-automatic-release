import * as core from '@actions/core'
import { GitHub } from '@actions/github/lib/utils'
import { Context } from '@actions/github/lib/context'
import { Octokit } from '@octokit/rest'
import { valid as semverValid, rcompare as semverRcompare, lt as semverLt } from 'semver'

import ChangeLog from './ChangeLog'
import { Args, getAndValidateArgs } from './Args'
import { getGitTag } from './utils'

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function exportOutput(name: string, value: string | number) {
    core.info(`Exporting env variable ${name}=${value}`)
    core.exportVariable(name.toUpperCase(), value)
    core.setOutput(name.toLowerCase(), value)
}

type ParsedTag = {
    name: string,
    semverName: string,
}

// ----------------------------------------------------------------------------
// AutomaticRelease
// ----------------------------------------------------------------------------

export default class AutomaticRelease {
    readonly args: Args
    client: InstanceType<typeof GitHub>
    context: Context

    sha: string = ''
    releaseTag: string = ''
    prevReleaseTag: string = ''

    constructor() {
        core.startGroup('Initializing AutomaticRelease')
        this.args = getAndValidateArgs()
        this.client = new Octokit({ auth: process.env.GITHUB_TOKEN })
        this.context = new Context()
        core.endGroup()

        core.info(`owner:${this.context.repo.owner} repo:${this.context.repo.repo}`)
    }

    async run(): Promise<void> {
        await this.determineHeadRef()
        await this.determineReleaseTags()

        if (this.args.autoReleaseTag) {
            await this.deleteRelease(this.args.autoReleaseTag)
            await this.recreateTag(this.args.autoReleaseTag)
        }

        const { releaseId, uploadUrl } = await this.createRelease()

        core.startGroup('Exporting Outputs')
        exportOutput('tag', this.releaseTag)
        exportOutput('prev_tag', this.prevReleaseTag)
        exportOutput('release_id', releaseId)
        exportOutput('upload_url', uploadUrl)
        core.endGroup()
    }

    private async determineHeadRef(): Promise<void> {
        core.startGroup('Determining head ref')

        const resp = await this.client.git.getRef({
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            ref: 'heads/master',
        })

        this.sha = resp.data.object.sha
        core.info(`HEAD: ${this.sha}`)
        core.endGroup()
    }

    private async determineReleaseTags(): Promise<void> {
        const autoTag = this.args.autoReleaseTag
        core.startGroup(`Determining release tags ${autoTag}`)

        if (autoTag) {
            this.releaseTag = autoTag
            this.prevReleaseTag = autoTag
        } else {
            this.releaseTag = getGitTag(this.context.ref)

            if (!this.releaseTag) {
                throw new Error(`The parameter "automatic_release_tag" was not set and this does not appear to be a GitHub tag event. (Event: ${this.context.ref})`)
            }

            this.prevReleaseTag = await this.searchForPreviousReleaseTag()
        }

        core.info(`releaseTag:${this.releaseTag} prevReleaseTag:${this.prevReleaseTag}`)
        core.endGroup()
    }

    private async searchForPreviousReleaseTag(): Promise<string> {
        const validSemver = semverValid(this.releaseTag)
        if (!validSemver) {
            throw new Error(`The parameter "automatic_release_tag" was not set and the current tag "${this.releaseTag}" does not appear to conform to semantic versioning.`)
        }

        const listTagsOptions = this.client.repos.listTags.endpoint.merge(this.context.repo)
        const tl = await this.client.paginate(listTagsOptions) as Array<ParsedTag>

        const tagList = tl
            .map((tag) => {
                return {
                    name: tag.name,
                    semverName: semverValid(tag.name) || '',
                }
            })
            .filter((tag) => !!tag.semverName)
            .sort((a, b) => semverRcompare(a.semverName, b.semverName))

        let previousReleaseTag = ''
        for (const tag of tagList) {
            if (semverLt(tag.semverName, this.releaseTag)) {
                previousReleaseTag = tag.name
                break
            }
        }

        return previousReleaseTag
    }

    private async recreateTag(tag: string): Promise<void> {
        core.startGroup('Generating release tag')

        const ref = `refs/tags/${tag}`
        const existingRef = `tags/${tag}`

        try {
            core.info(`Attempting to create release tag "${tag}" ${this.sha}`)
            await this.client.git.createRef({
                owner: this.context.repo.owner,
                repo: this.context.repo.repo,
                sha: this.sha,
                ref: ref,
            })

            core.info(`Successfully created release tag "${tag}"`)
        } catch (e) {
            const error = e as Error

            // 'Reference already exists' errors are acceptable because then we just need to update it
            if (error.message !== 'Reference already exists') {
                core.error(`Failed to create new tag "${ref}" (${error.message})`)
                throw error
            }

            try {
                console.info(`Attempting to update existing tag "${existingRef}"`)
                await this.client.git.updateRef({
                    owner: this.context.repo.owner,
                    repo: this.context.repo.repo,
                    sha: this.sha,
                    ref: existingRef,
                    force: true,
                })
            } catch (e) {
                const error = e as Error
                core.error(`Failed to update ref "${existingRef}" (${error.message})`)
                throw error
            }

            core.info(`Successfully updated release tag "${tag}"`)
        }

        core.endGroup()
    }

    private async deleteRelease(tag: string): Promise<void> {
        core.startGroup(`Deleting GitHub release associated with the tag "${tag}"`)

        core.info(`Searching for release corresponding to the "${tag}" tag`)
        try {
            const resp = await this.client.repos.getReleaseByTag({
                owner: this.context.repo.owner,
                repo: this.context.repo.repo,
                tag: tag,
            })

            core.info(`Deleting release: ${resp.data.id}`)
            await this.client.repos.deleteRelease({
                owner: this.context.repo.owner,
                repo: this.context.repo.repo,
                release_id: resp.data.id,
            })
        } catch (e) {
            const error = e as Error

            // Not Found errors are acceptable because it can happen on first run when there's no release associated with the tag yet
            if (error.message !== 'Not Found') {
                core.error(`Could not delete release with tag "${tag}" (${error.message})`)
                throw error
            }
        }

        core.endGroup()
    }

    private async createRelease(): Promise<{ releaseId: number, uploadUrl: string }> {
        core.startGroup(`Creating new GitHub release for the "${this.releaseTag}" tag`)

        core.info('Generating Release Log')
        const changeLog = new ChangeLog(this.args)
        await changeLog.run(this.prevReleaseTag, this.sha)

        core.info('Release Log:')
        core.info(changeLog.toString())

        const releaseConfig = {
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            tag_name: this.releaseTag,
            name: (this.args.autoReleaseTitle && this.args.autoReleaseTag) ? this.args.autoReleaseTitle : this.releaseTag,
            draft: this.args.isDraft,
            prerelease: this.args.isPreRelease,
            body: changeLog.toString(),
        }
        let releaseId = -1
        let uploadUrl = ''

        try {
            core.info(`Creating new release for the "${this.releaseTag}" tag`)

            const resp = await this.client.repos.createRelease(releaseConfig)
            releaseId = resp.data.id
            uploadUrl = resp.data.upload_url

            core.info(`Created release ${releaseId}: ${uploadUrl}`)
        } catch (e) {
            const error = e as Error

            // Already exists errors are acceptable because then we just need to update it
            if (!/Validation Failed.+"resource":"Release".+"code":"already_exists"/.exec(error.message)) {
                core.error(`Failed to create new release (${error.message})`)
                throw error
            }

            try {
                console.info(`Attempting to update existing release for the "${this.releaseTag}" tag`)

                {
                    const resp = await this.client.repos.getReleaseByTag({
                        ...releaseConfig,
                        tag: this.releaseTag,
                    })

                    releaseId = resp.data.id
                    uploadUrl = resp.data.upload_url
                }

                core.info(`Successfully fetched release ${releaseId}: ${uploadUrl}`)

                {
                    const resp = await this.client.repos.updateRelease({
                        ...releaseConfig,
                        release_id: releaseId,
                    })

                    releaseId = resp.data.id
                    uploadUrl = resp.data.upload_url
                }

                core.info(`Successfully updated release ${releaseId}: ${uploadUrl}`)
            } catch (e) {
                const error = e as Error
                core.error(`Failed to update release (${error.message})`)
                throw error
            }
        }

        core.endGroup()
        return { releaseId, uploadUrl }
    }
}
