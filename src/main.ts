import * as core from '@actions/core'
import AutomaticRelease from './AutomaticRelease.js'

try {
    const githubToken = process.env.GITHUB_TOKEN
    if (!githubToken) {
        throw new Error('process.env.GITHUB_TOKEN is undefined')
    }

    const isDryRun = process.env.DRY_RUN?.toLowerCase() === 'true'
    const automaticRelease = new AutomaticRelease({
        githubToken,
        isDryRun,
    })

    await automaticRelease.run()
} catch (error) {
    core.setFailed(String(error))
}
