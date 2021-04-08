import * as core from '@actions/core'
import { GitHub } from '@actions/github/lib/utils'
import { Context } from '@actions/github/lib/context'
import { Octokit } from '@octokit/rest'
import { EOL } from 'os'
import { sync as commitParser } from 'conventional-commits-parser'

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const SHORT_SHA_LEN = 8

enum ConventionalCommitTypes {
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

type ParsedCommit = {
    isBreakingChange: boolean
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

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function isBreakingChange(body: string | null, footer: string | null): boolean {
    const re = /^BREAKING\s+CHANGES?:\s+/
    return re.test(body ?? '') || re.test(footer ?? '')
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

function getChangeLog(parsedCommits: Array<ParsedCommit>, label: string, filter: (c: ParsedCommit) => boolean): string {
    let changeLog = ''

    const filteredCommitLogs = parsedCommits
        .filter(filter)
        .map((commit) => getFormattedChangeLogEntry(commit))

    if (filteredCommitLogs.length > 0) {
        changeLog += EOL + EOL
        changeLog += EOL + EOL
        changeLog += `## ${label}` + EOL
        changeLog += filteredCommitLogs.join(EOL).trim()
    }

    return changeLog
}

function generateChangeLogFromParsedCommits(parsedCommits: Array<ParsedCommit>): string {
    let changeLog = ''

    // Breaking Changes
    changeLog += getChangeLog(parsedCommits, 'Breaking Changes', (commit) => commit.isBreakingChange)

    // Labelled Changes
    for (const [key, label] of Object.entries(ConventionalCommitTypes)) {
        changeLog += getChangeLog(parsedCommits, label, (commit) => commit.type === key)
    }

    // Unlabelled Changes
    changeLog += getChangeLog(parsedCommits, 'Commits', (commit) => {
        if (commit.type) {
            return !(commit.type in ConventionalCommitTypes)
        }

        return true
    })

    return changeLog.trim()
}

// ----------------------------------------------------------------------------
// Change Log
// ----------------------------------------------------------------------------

export default class ChangeLog {
    client: InstanceType<typeof GitHub>
    context: Context

    parsedCommits: Array<ParsedCommit> = []

    constructor() {
        this.client = new Octokit({ auth: process.env.GITHUB_TOKEN })
        this.context = new Context()
    }

    async run(prevReleaseTag: string, headSha: string): Promise<void> {
        this.parsedCommits = await this.getCommitsSinceLastRelease(prevReleaseTag, headSha)
    }

    toString(): string {
        return generateChangeLogFromParsedCommits(this.parsedCommits)
    }

    private async getCommitsSinceLastRelease(prevReleaseTag: string, headSha: string): Promise<Array<ParsedCommit>> {
        try {
            const prevRef = `tags/${prevReleaseTag}`

            // Check if the tag exists
            // e.g. when we have an autoReleaseTag, the tag may not exist first time that this action runs
            await this.client.git.getRef({
                ...this.context.repo,
                ref: prevRef,
            })
        } catch (e) {
            // Not Found errors are acceptable because it's the first release
            const error = e as Error
            if (error.message !== 'Not Found') {
                throw error
            }

            core.info(`Failed to verify "${prevReleaseTag}" exists. Assume that this is the first time this GitHub Action is being run.`)
            prevReleaseTag = 'HEAD'
        }

        try {
            core.info(`Retrieving commits between ${prevReleaseTag} and ${headSha}`)
            const compareResult = await this.client.repos.compareCommits({
                ...this.context.repo,
                base: prevReleaseTag,
                head: headSha,
            })

            const parsedCommits: Array<ParsedCommit> = []
            for (const commit of compareResult.data.commits) {
                core.info(`Processing commit ${commit.sha}`)

                const parsedCommit = commitParser(commit.commit.message)
                if (parsedCommit.merge || parsedCommit.header?.startsWith('Merge')) {
                    core.info(`Skipping merge commit ${commit.sha}`)
                    continue
                }

                const pullRequests = await this.client.repos.listPullRequestsAssociatedWithCommit({
                    owner: this.context.repo.owner,
                    repo: this.context.repo.repo,
                    commit_sha: commit.sha,
                })

                parsedCommits.push({
                    ...parsedCommit,

                    isBreakingChange: isBreakingChange(parsedCommit.body, parsedCommit.footer),
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

            core.info(`Successfully retrieved ${parsedCommits.length} commits between ${prevReleaseTag} and ${headSha}`)
            return parsedCommits
        } catch (e) {
            throw new Error(`Failed to get commits between ${prevReleaseTag} and ${headSha}`)
        }
    }
}
