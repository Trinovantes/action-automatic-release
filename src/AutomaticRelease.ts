import * as core from '@actions/core'
import { Context } from '@actions/github/lib/context'
import { Octokit } from '@octokit/rest'
import { getAndValidateArgs, IArgs } from './Args'
import ChangeLog from './ChangeLog'
import { exportOutput, extractTagName, searchPrevReleaseTag } from './utils'

// ----------------------------------------------------------------------------
// AutomaticRelease
// ----------------------------------------------------------------------------

export default class AutomaticRelease {
    readonly args: IArgs
    readonly client: Octokit
    readonly context: Context

    constructor() {
        core.startGroup('Initializing AutomaticRelease')

        this.args = getAndValidateArgs()
        console.log(this.args)

        this.client = new Octokit({ auth: process.env.GITHUB_TOKEN })
        this.context = new Context()
        console.log(`owner:${this.context.repo.owner} repo:${this.context.repo.repo}`)

        core.endGroup()
    }

    async run(): Promise<void> {
        const head = await this.determineHeadRef()

        // --------------------------------------------------------------------
        // Determine the start/end tags
        // --------------------------------------------------------------------

        core.startGroup('Determining release tags')

        let currReleaseTag: string
        let prevReleaseTag: string

        if (this.args.autoReleaseTag) {
            currReleaseTag = head
            prevReleaseTag = this.args.autoReleaseTag
        } else {
            const currentTag = extractTagName(this.context.ref)
            currReleaseTag = currentTag
            prevReleaseTag = await searchPrevReleaseTag(this.client, this.context.repo, currentTag) ?? currentTag
        }

        console.log(`currReleaseTag:${currReleaseTag} prevReleaseTag:${prevReleaseTag}`)
        core.endGroup()

        // --------------------------------------------------------------------
        // Determine changelog
        // --------------------------------------------------------------------

        core.startGroup('Generating release tags')

        const changeLog = new ChangeLog()
        await changeLog.run(prevReleaseTag, currReleaseTag)

        core.endGroup()

        // --------------------------------------------------------------------
        // Delete and recreate the autoReleaseTag if necessary
        // --------------------------------------------------------------------

        if (this.args.autoReleaseTag) {
            await this.deleteRelease(this.args.autoReleaseTag)
            await this.createOrUpdateTag(this.args.autoReleaseTag, head)
        }

        // --------------------------------------------------------------------
        // Create new release for the currReleaseTag
        // --------------------------------------------------------------------

        const releaseName: string = (this.args.autoReleaseTag)
            ? this.args.autoReleaseTitle || currReleaseTag
            : currReleaseTag

        const { releaseId, uploadUrl } = await this.createRelease(currReleaseTag, releaseName, changeLog.toString())

        // --------------------------------------------------------------------
        // Finally export the outputs
        // --------------------------------------------------------------------

        core.startGroup('Exporting Outputs')
        exportOutput('tag', currReleaseTag)
        exportOutput('prev_tag', prevReleaseTag)
        exportOutput('release_id', releaseId)
        exportOutput('upload_url', uploadUrl)
        core.endGroup()
    }

    private async determineHeadRef(): Promise<string> {
        core.startGroup('Determining head ref')

        const res = await this.client.git.getRef({
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            ref: `heads/${this.args.branch}`,
        })

        const head = res.data.object.sha
        core.info(`HEAD: ${head}`)

        core.endGroup()
        return head
    }

    async deleteRelease(tag: string): Promise<void> {
        core.startGroup(`Deleting GitHub Release associated with the tag "${tag}"`)

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

    async createOrUpdateTag(tag: string, head: string): Promise<void> {
        core.startGroup(`Creating GitHub Release tag "${tag}"`)

        if (!head) {
            throw new Error('Invalid HEAD')
        }

        const ref = `refs/tags/${tag}`
        const existingRef = `tags/${tag}`

        try {
            core.info(`Attempting to create release tag "${tag}" for ${head}`)
            await this.client.git.createRef({
                owner: this.context.repo.owner,
                repo: this.context.repo.repo,
                sha: head,
                ref: ref,
            })

            core.info(`Successfully created release tag "${tag}"`)
        } catch (err) {
            const error = err as Error

            // 'Reference already exists' errors are acceptable because then we just need to update it
            if (error.message !== 'Reference already exists') {
                core.error(`Failed to create new tag "${ref}" (${error.message})`)
                throw error
            }

            try {
                core.info(`Attempting to update existing tag "${existingRef}"`)
                await this.client.git.updateRef({
                    owner: this.context.repo.owner,
                    repo: this.context.repo.repo,
                    sha: head,
                    ref: existingRef,
                    force: true,
                })
            } catch (err) {
                const error = err as Error
                core.error(`Failed to update ref "${existingRef}" (${error.message})`)
                throw error
            }

            core.info(`Successfully updated release tag "${tag}"`)
        }

        core.endGroup()
    }

    async createRelease(tag: string, releaseName: string, changeLog: string): Promise<{ releaseId: number; uploadUrl: string }> {
        core.startGroup(`Creating new GitHub release for the "${tag}" tag`)

        const releaseConfig = {
            owner: this.context.repo.owner,
            repo: this.context.repo.repo,
            tag_name: tag,
            name: releaseName,
            draft: this.args.isDraft,
            prerelease: this.args.isPreRelease,
            body: changeLog,
        }
        let releaseId = -1
        let uploadUrl = ''

        try {
            core.info(`Creating new release for the "${tag}" tag`)

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
                core.info(`Attempting to update existing release for the "${tag}" tag`)
                {
                    const resp = await this.client.repos.getReleaseByTag({
                        ...releaseConfig,
                        tag: tag,
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
