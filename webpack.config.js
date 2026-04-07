let out = "/public/" + process.env.npm_lifecycle_event.split(" ")[1]let out = "/public/" + process.env.npm_lifecycle_event.split(" ")[1]

module.exports = {
    optimization: {
        minimize: true
    },
    entry: {
        //environment parameter generation code
        generator: "./src/generator.js",
        //fingerprint modification logic code
        window: "./src/window.js",
        //test code - randomly generate parameters to modify the fingerprint environment
        randomTest: "./src/randomTest.js",
    },
    output: {
        filename: '[name].js',
        path: __dirname + out,
    },
    plugins: [],
    module: {}

}
