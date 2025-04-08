import * as core from '@actions/core'
import { Context } from '@actions/github/lib/context.js'
import { Octokit } from '@octokit/rest'
import { getActionArgs, type ActionArgs } from './ActionArgs.ts'
import { ALL_COMMIT_TYPES, type ParsedCommit } from './ParsedCommit.ts'
import { valid as semverValid, rcompare as semverRcompare, lt as semverLt } from 'semver'
import { EOL } from 'node:os'
import { CommitParser } from 'conventional-commits-parser'
import type { Brand } from './@types/Brand.ts'

const SHORT_SHA_LEN = 8

type TagName = Brand<string, 'TagName'>
type CommitHash = Brand<string, 'CommitHash'>
type ReleaseId = Brand<number, 'ReleaseId'>

type ActionOutput = {
    currReleaseTag: TagName | CommitHash
    prevReleaseTag: TagName | CommitHash
    releaseId: number
    uploadUrl: string
}

type GitHubTagResponse = {
    name: TagName
    zipball_url: string
    tarball_url: string
    commit: {
        sha: CommitHash
        url: string
    }
    node_id: string
}

export default class AutomaticRelease {
    readonly isDryRun: boolean
    readonly actionArgs: ActionArgs
    readonly ghClient: Octokit
    readonly ghContext: Context

    constructor(params: {
        githubToken: string
        isDryRun?: boolean
    }) {
        this.isDryRun = params.isDryRun ?? false
        this.actionArgs = getActionArgs()
        this.ghClient = new Octokit({ auth: params.githubToken })
        this.ghContext = new Context()
    }

    // ----------------------------------------------------------------------------
    // MARK: Run
    // ----------------------------------------------------------------------------

    async run(): Promise<void> {
        core.info(JSON.stringify(this.actionArgs, undefined, 4))

        const output = this.actionArgs.autoReleaseTag
            ? await this.runForAutoReleaseTag()
            : await this.runForExplicitTag()

        this.writeOutput(output)
    }

    private async runForAutoReleaseTag(): Promise<ActionOutput> {
        const autoReleaseTag = this.actionArgs.autoReleaseTag as TagName
        const autoReleaseTitle = this.actionArgs.autoReleaseTitle
        if (!autoReleaseTitle) {
            throw new Error('auto_release_title is not set')
        }

        const headHash = await this.getHeadHash()
        const changeLog = await this.generateChangeLog(autoReleaseTag, headHash)

        await this.deleteReleaseForTag(autoReleaseTag)
        await this.createOrUpdateTag(autoReleaseTag, headHash)

        const { releaseId, uploadUrl } = await this.createOrUpdateRelease(autoReleaseTag, autoReleaseTitle, changeLog)
        return {
            currReleaseTag: headHash,
            prevReleaseTag: autoReleaseTag,
            releaseId,
            uploadUrl,
        }
    }

    private async runForExplicitTag(): Promise<ActionOutput> {
        const currReleaseTag = getTagName(this.ghContext.ref)
        const prevReleaseTag = await this.getTagBeforeCurrentTag(currReleaseTag) ?? currReleaseTag
        const changeLog = await this.generateChangeLog(prevReleaseTag, currReleaseTag)

        const { releaseId, uploadUrl } = await this.createOrUpdateRelease(currReleaseTag, currReleaseTag, changeLog)
        return {
            currReleaseTag,
            prevReleaseTag,
            releaseId,
            uploadUrl,
        }
    }

    private writeOutput(output: ActionOutput) {
        runSyncGroup('Exporting Outputs', () => {
            core.info(JSON.stringify(output, undefined, 4))
            core.setOutput('tag', output.currReleaseTag)
            core.setOutput('prev_tag', output.prevReleaseTag)
            core.setOutput('release_id', output.releaseId)
            core.setOutput('upload_url', output.uploadUrl)
        })
    }

    // ----------------------------------------------------------------------------
    // MARK: API Helpers
    // ----------------------------------------------------------------------------

    private async isTagExists(refName: `tags/${TagName}`): Promise<boolean> {
        return Boolean(await this.getTagHash(refName))
    }

    private async getTagHash(refName: `tags/${TagName}`): Promise<CommitHash | null> {
        // core.info(`Failed to verify prevRelease:"${prevRelease}" exists. Assume that this is the first time this GitHub Action is being run.`)
        // e.g. when we have an autoReleaseTag, the tag may not exist first time that this action runs

        try {
            const res = await this.ghClient.git.getRef({
                ...this.ghContext.repo,
                ref: refName,
            })

            return res.data.object.sha as CommitHash
        } catch (error) {
            if (error instanceof Error && error.message.includes('Not Found')) {
                return null
            }

            throw error
        }
    }

    private async getReleaseId(tagName: TagName): Promise<ReleaseId | null> {
        try {
            const res = await this.ghClient.repos.getReleaseByTag({
                ...this.ghContext.repo,
                tag: tagName,
            })

            return res.data.id as ReleaseId
        } catch (error) {
            if (error instanceof Error && error.message.includes('Not Found')) {
                return null
            }

            throw error
        }
    }

    private async getHeadHash(): Promise<CommitHash> {
        return await runAsyncGroup('Determining head ref', async () => {
            const res = await this.ghClient.git.getRef({
                owner: this.ghContext.repo.owner,
                repo: this.ghContext.repo.repo,
                ref: `heads/${this.actionArgs.branch}`,
            })

            const head = res.data.object.sha as CommitHash
            core.info(`HEAD: ${head}`)

            return head
        })
    }

    private async getTagBeforeCurrentTag(currentTag: TagName): Promise<TagName | null> {
        const validSemver = semverValid(currentTag)
        if (!validSemver) {
            throw new Error(`The currentTag "${currentTag}" does not appear to conform to semantic versioning.`)
        }

        const listTagsOptions = this.ghClient.repos.listTags.endpoint.merge(this.ghContext.repo)
        const allTags = await this.ghClient.paginate(listTagsOptions) as Array<GitHubTagResponse>
        const semverTags = allTags
            .filter((tag) => semverValid(tag.name))
            .map((tag) => ({
                name: tag.name,
                semverName: tag.name,
            }))
            .sort((a, b) => semverRcompare(a.semverName, b.semverName))

        for (const tag of semverTags) {
            if (semverLt(tag.semverName, currentTag)) {
                return tag.name
            }
        }

        // There is no tag before the currentTag
        return null
    }

    private async generateChangeLog(prevReleaseTag: TagName, currRelease: TagName | CommitHash) {
        return await runAsyncGroup('Generating ChangeLog', async () => {
            let changeLog = ''
            const writeToChangeLog = (parsedCommits: Array<ParsedCommit>, label: string, filter: (c: ParsedCommit) => boolean) => {
                const filteredCommitLogs = parsedCommits
                    .filter(filter)
                    .map((commit) => getFormattedChangeLogEntry(commit))

                if (filteredCommitLogs.length > 0) {
                    changeLog += EOL + EOL
                    changeLog += EOL + EOL
                    changeLog += `## ${label}` + EOL
                    changeLog += filteredCommitLogs.join(EOL).trim()
                }
            }

            const parsedCommits = await this.getCommitsBetweenCommits(prevReleaseTag, currRelease)

            // Breaking Changes
            writeToChangeLog(parsedCommits, 'Breaking Changes', (commit) => {
                const re = /^BREAKING\s+CHANGES?:\s+/
                return re.test(commit.body ?? '') || re.test(commit.footer ?? '')
            })

            // Labelled Changes
            for (const { key, label } of ALL_COMMIT_TYPES) {
                writeToChangeLog(parsedCommits, label, (commit) => commit.type === key)
            }

            // Unlabelled Changes
            const commitTypeKeys = ALL_COMMIT_TYPES.map((t) => t.key)
            writeToChangeLog(parsedCommits, 'Commits', (commit) => !commit.type || !commitTypeKeys.includes(commit.type))

            changeLog = changeLog.trim()

            core.info('Finished generating ChangeLog')
            core.info(changeLog)
            return changeLog
        })
    }

    private async getCommitsBetweenCommits(prevReleaseTag: TagName, currRelease: TagName | CommitHash): Promise<Array<ParsedCommit>> {
        const prevRelease = await this.isTagExists(`tags/${prevReleaseTag}`)
            ? prevReleaseTag
            : 'HEAD' as TagName

        core.info(`Retrieving commits between prevRelease:"${prevRelease}" and currRelease:"${currRelease}"`)
        const compareResult = await this.ghClient.repos.compareCommits({
            ...this.ghContext.repo,
            base: prevRelease,
            head: currRelease,
        })

        const parsedCommits: Array<ParsedCommit> = []
        for (const commit of compareResult.data.commits) {
            core.info(`Processing commit ${commit.sha}`)

            const commitParser = new CommitParser()
            const parsedCommit = commitParser.parse(commit.commit.message)
            if (parsedCommit.merge || parsedCommit.header?.startsWith('Merge')) {
                core.info(`Skipping merge commit ${commit.sha}`)
                continue
            }

            const pullRequests = await this.ghClient.repos.listPullRequestsAssociatedWithCommit({
                owner: this.ghContext.repo.owner,
                repo: this.ghContext.repo.repo,
                commit_sha: commit.sha,
            })

            parsedCommits.push({
                ...parsedCommit,

                authorName: commit.commit.author?.name ?? 'Unknown Author',
                htmlUrl: commit.html_url,
                sha: commit.sha,

                pullRequests: pullRequests.data.map((pr) => {
                    return {
                        number: pr.number,
                        url: pr.html_url,
                    }
                }),
            })
        }

        core.info(`Successfully retrieved ${parsedCommits.length} commits between ${prevRelease} and ${currRelease}`)
        return parsedCommits
    }

    private async deleteReleaseForTag(tag: TagName): Promise<void> {
        if (this.isDryRun) {
            return
        }

        await runAsyncGroup(`Deleting release associated with tag "${tag}"`, async () => {
            const releaseId = await this.getReleaseId(tag)
            if (!releaseId) {
                return
            }

            await this.ghClient.repos.deleteRelease({
                owner: this.ghContext.repo.owner,
                repo: this.ghContext.repo.repo,
                release_id: releaseId,
            })

            await this.ghClient.rest.git.deleteRef({
                owner: this.ghContext.repo.owner,
                repo: this.ghContext.repo.repo,
                ref: `tags/${tag}`,
            })
        })
    }

    private async createOrUpdateTag(tag: TagName, headHash: CommitHash): Promise<void> {
        if (this.isDryRun) {
            return
        }

        await runAsyncGroup(`Creating or updating tag "${tag}"`, async () => {
            const tagExists = await this.getTagHash(`tags/${tag}`)
            if (tagExists) {
                core.info(`Attempting to update existing tag "${tag}"`)
                await this.ghClient.git.updateRef({
                    owner: this.ghContext.repo.owner,
                    repo: this.ghContext.repo.repo,
                    sha: headHash,
                    ref: `tags/${tag}`,
                    force: true,
                })
                core.info(`Successfully updated existing tag "${tag}"`)
            } else {
                core.info(`Attempting to create new tag "${tag}" for ${headHash}`)
                await this.ghClient.git.createRef({
                    owner: this.ghContext.repo.owner,
                    repo: this.ghContext.repo.repo,
                    sha: headHash,
                    ref: `refs/tags/${tag}`,
                })
                core.info(`Successfully created new tag "${tag}"`)
            }
        })
    }

    private async createOrUpdateRelease(tag: TagName, releaseName: string, changeLog: string): Promise<{ releaseId: number; uploadUrl: string }> {
        if (this.isDryRun) {
            return {
                releaseId: -1,
                uploadUrl: '',
            }
        }

        return await runAsyncGroup(`Create or update release for the "${tag}" tag`, async () => {
            const releaseConfig = {
                owner: this.ghContext.repo.owner,
                repo: this.ghContext.repo.repo,
                tag_name: tag,
                name: releaseName,
                draft: this.actionArgs.isDraft,
                prerelease: this.actionArgs.isPreRelease,
                body: changeLog,
            }

            const releaseId = await this.getReleaseId(tag)
            if (releaseId) {
                core.info(`Attempting to update existing release for tag "${tag}"`)
                const res = await this.ghClient.repos.updateRelease({ ...releaseConfig, release_id: releaseId })
                core.info(`Successfully updated existing release for tag "${tag}"`)

                return {
                    releaseId: res.data.id,
                    uploadUrl: res.data.upload_url,
                }
            } else {
                core.info(`Attempting to create new release for tag "${tag}"`)
                const res = await this.ghClient.repos.createRelease(releaseConfig)
                core.info(`Successfully created new release for tag "${tag}"`)

                return {
                    releaseId: res.data.id,
                    uploadUrl: res.data.upload_url,
                }
            }
        })
    }
}

// ----------------------------------------------------------------------------
// MARK: Helpers
// ----------------------------------------------------------------------------

function runSyncGroup<T>(label: string, run: () => T) {
    core.startGroup(label)
    const res = run()
    core.endGroup()
    return res
}

async function runAsyncGroup<T>(label: string, run: () => Promise<T>) {
    core.startGroup(label)
    const res = await run()
    core.endGroup()
    return res
}

function getFormattedChangeLogEntry(commit: ParsedCommit): string {
    const url = commit.htmlUrl
    const shortSha = commit.sha.substring(0, SHORT_SHA_LEN - 1)
    const author = commit.authorName

    const prMessages = commit.pullRequests.map((pr) => `[#${pr.number}](${pr.url})`)
    const prString = prMessages.join(',')

    let entry = '- '

    if (commit.type) {
        if (commit.scope) {
            entry += `**${commit.scope}**: `
        }

        entry = `${commit.subject}${prString} ([${author}](${url}))`
    } else {
        entry = `[\`${shortSha}\`](${url}): ${commit.header} (${author}) ${prString}`
    }

    return entry
}

function getTagName(tagRef: string): TagName {
    const re = /^(refs\/)?tags\/(?<tagName>.*)$/
    const matches = re.exec(tagRef)
    const tagName = matches?.groups?.tagName

    if (!tagName) {
        throw new Error(`Reference "${tagRef}" does not appear to be a tag`)
    }

    return tagName as TagName
}
