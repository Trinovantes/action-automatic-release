import * as core from '@actions/core'
import { GitHub } from '@actions/github/lib/utils'
import { Context } from '@actions/github/lib/context'
import { Octokit } from '@octokit/rest'
import { EOL } from 'os'
import { sync as commitParser } from 'conventional-commits-parser'

import { Args } from './Args'
import { getGitTag } from './utils'

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
    origMessage: string
    htmlUrl: string
    sha: string

    type?: string
    header?: string
    footer?: string
    body?: string
    merge?: string
    scope?: string
    subject?: string

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
    return re.test(body || '') || re.test(footer || '')
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
        entry = `[[${shortSha}](${url})]: ${commit.header} (${author}) ${prString}`
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
    readonly args: Args
    client: InstanceType<typeof GitHub>
    context: Context

    parsedCommits: Array<ParsedCommit> = []

    constructor(args: Args) {
        this.args = args
        this.client = new Octokit({ auth: process.env.GITHUB_TOKEN })
        this.context = new Context()
    }

    async run(prevReleaseTag: string, headSha: string): Promise<void> {
        const commits = await this.getCommitsSinceLastRelease(prevReleaseTag, headSha)
        this.parsedCommits = await this.parseCommits(commits)
    }

    toString(): string {
        return generateChangeLogFromParsedCommits(this.parsedCommits)
    }

    private async getCommitsSinceLastRelease(prevReleaseTag: string, headSha: string): Promise<Array<ParsedCommit>> {
        core.info('Retrieving commit history')

        const prevRef = `tags/${prevReleaseTag}`
        const owner = this.context.repo.owner
        const repo = this.context.repo.repo

        core.info('Determining state of the previous release')
        let previousReleaseRef: string

        // eslint-disable-next-line no-lone-blocks
        {
            try {
                core.info(`Searching for SHA corresponding to previous "${prevRef}" release tag`)

                // Check if the tag exists or throw error
                await this.client.git.getRef({
                    owner: owner,
                    repo: repo,
                    ref: prevRef,
                })
                previousReleaseRef = getGitTag(prevRef)
            } catch (e) {
                const error = e as Error
                core.info(`Could not find SHA corresponding to tag "${prevRef}" (${error.message}). Assuming this is the first release.`)
                previousReleaseRef = 'HEAD'
            }
        }

        core.info(`Retrieving commits between ${previousReleaseRef} and ${headSha}`)
        const parsedCommits: Array<ParsedCommit> = []

        // eslint-disable-next-line no-lone-blocks
        {
            try {
                const compareResult = await this.client.repos.compareCommits({
                    owner: owner,
                    repo: repo,
                    base: previousReleaseRef,
                    head: headSha,
                })
                for (const commit of compareResult.data.commits) {
                    parsedCommits.push({
                        isBreakingChange: false,

                        authorName: commit.commit.author?.name ?? '',
                        origMessage: commit.commit.message,
                        htmlUrl: commit.html_url,
                        sha: commit.sha,

                        pullRequests: [],
                    })
                }

                core.info(`Successfully retrieved ${compareResult.data.commits.length} commits between ${previousReleaseRef} and ${headSha}`)
            } catch (e) {
                core.info(`Could not find any commits between ${previousReleaseRef} and ${headSha}`)
            }
        }

        core.info(JSON.stringify(parsedCommits))
        return parsedCommits
    }

    private async parseCommits(commits: Array<ParsedCommit>): Promise<Array<ParsedCommit>> {
        core.info('Parsing Commits')

        for (const commit of commits) {
            core.info(`Processing commit: ${JSON.stringify(commit)}`)

            core.info(`Searching for pull requests associated with commit ${commit.sha}`)
            const pulls = await this.client.repos.listPullRequestsAssociatedWithCommit({
                owner: this.context.repo.owner,
                repo: this.context.repo.repo,
                commit_sha: commit.sha,
            })
            core.info(`Found ${pulls.data.length} pull request(s) associated with commit ${commit.sha}`)

            const parsedCommit = commitParser(commit.origMessage)
            core.info(`Parsed commit: ${JSON.stringify(parsedCommit)}`)

            if (commit.merge) {
                core.info(`Ignoring merge commit: ${commit.merge}`)
                continue
            }

            if (parsedCommit.type) {
                commit.type = parsedCommit.type
            }

            if (parsedCommit.header) {
                commit.header = parsedCommit.header
            }

            if (parsedCommit.footer) {
                commit.footer = parsedCommit.footer
            }

            if (parsedCommit.body) {
                commit.body = parsedCommit.body
            }

            if (parsedCommit.merge) {
                commit.merge = parsedCommit.merge
            }

            if (parsedCommit.scope) {
                commit.scope = parsedCommit.scope
            }

            if (parsedCommit.subject) {
                commit.subject = parsedCommit.subject
            }

            commit.isBreakingChange = isBreakingChange(parsedCommit.body, parsedCommit.footer)
            commit.pullRequests = pulls.data.map((pr) => {
                return {
                    number: pr.number,
                    url: pr.html_url,
                }
            })
        }

        core.info(JSON.stringify(commits))
        return commits
    }
}
