module.exports = {
    presets: [["@babel/preset-env", {
        targets: {
            "chrome": "66",
        },
        corejs: 2, // Newer versions require specifying the core library version
        useBuiltIns: "usage" // Add on demand
    }]],
    "plugins": [
        [
            "@babel/plugin-transform-runtime", // Transforms code that doesn't have a direct equivalent.
            {
                "absoluteRuntime": false,
                "corejs": 2, //false: global injection, which will pollute the global environment; 2: will not pollute the global environment.
                "helpers": true,
                "regenerator": true,
                "useESModules": false
            }
        ]
    ]
};
