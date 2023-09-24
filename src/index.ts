import * as core from '@actions/core'
import AutomaticRelease from './AutomaticRelease'

async function main() {
    try {
        if (!process.env.GITHUB_TOKEN) {
            throw new Error('process.env.GITHUB_TOKEN is undefined')
        }

        const automaticRelease = new AutomaticRelease()
        await automaticRelease.run()
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message)
        } else {
            core.setFailed(String(error))
        }
    }
}

void main()
