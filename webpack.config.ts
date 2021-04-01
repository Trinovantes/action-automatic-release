import path from 'path'
import webpack from 'webpack'

const Config: webpack.Configuration = {
    target: 'node',
    mode: 'production',
    entry: path.resolve(__dirname, './src/index.ts'),
    output: {
        filename: 'index.js',
    },

    resolve: {
        extensions: ['.ts', '.js'],
        modules: [
            path.resolve(__dirname, './src'),
            'node_modules',
        ],
    },

    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: [
                    'ts-loader',
                ],
            },
        ],
    },
}

export default Config
