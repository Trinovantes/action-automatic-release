import * as core from '@actions/core'
import AutomaticRelease from './AutomaticRelease'

async function main() {
    try {
        const automaticRelease = new AutomaticRelease()
        await automaticRelease.run()
    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message)
        } else {
            core.setFailed(error)
        }
    }
}

void main()
