#!/usr/bin/env node

// We're tryin'a be as isomorphic as possible... but React Native requires react-native to be a
// production dependency, and we don't want that biz in our containers. So:
const PACKAGE_BLACKLIST = ["sp-native"];

const fs = require("fs");
const path = require("path");
const output = [];
const add = str =>
  output.push(
    ...str
      .trim()
      .split("\n")
      .map(str => str.trim())
  );

add(`
  # ==============
  # DO NOT EDIT!!!
  # ==============
  #
  # This file is generated automatically by run/generate-dockerfile.js.
  # Edit that, not this.
`);

// build a minimal root package.json that doesn't change much for caching
const rootPkg = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8")
);

const buildPkg = {
  name: rootPkg.name,
  private: rootPkg.private,
  workspaces: rootPkg.workspaces
};

fs.writeFileSync(
  path.resolve(__dirname, "..", "package.build.json"),
  JSON.stringify(buildPkg, null, 2)
);

add(`
  FROM stream.place/sp-node AS base
  ADD package.build.json /app/package.json
`);

add("# add all package.json files");

const pkgs = {};

const packages = fs
  .readdirSync(path.resolve(__dirname, "..", "packages"))
  .filter(pkgName => {
    if (PACKAGE_BLACKLIST.includes(pkgName)) {
      // exclude eplicitly blacklisted packages
      return false;
    }
    try {
      pkgs[pkgName] = JSON.parse(
        fs.readFileSync(
          path.resolve(__dirname, "..", "packages", pkgName, "package.json")
        )
      );
    } catch (e) {
      // ENOTDIR happens b/c .DS_Store :(
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR") {
        throw e;
      }
      return false;
    }
    return true;
  })
  .map(pkgName => {
    const pkg = pkgs[pkgName];
    pkg.containerName = pkg.name.replace(/-/g, "");
    return pkg;
  });
packages.forEach(pkg => {
  add(
    `ADD packages/${pkg.name}/package.json /app/packages/${
      pkg.name
    }/package.json`
  );
});

add("# build everyone's development dependencies into one big blob");
add(`
  FROM stream.place/sp-node AS builder
  ENV NODE_ENV development
  RUN apt-get update && apt-get install -y python build-essential # needed for building binaries on ARM
  COPY --from=base /app /app
  RUN yarn install
`);

add("# build each package separately");
const buildPackages = packages.filter(pkg => {
  if (!pkg.scripts || !pkg.scripts.prepare) {
    return false;
  }
  // exclude frontend apps, they're handled separately
  if (pkg.devDependencies && pkg.devDependencies["react-scripts"]) {
    return false;
  }
  return true;
});
buildPackages.forEach(pkg => {
  add(`
    FROM builder AS ${pkg.containerName}
    ADD packages/${pkg.name}/src /app/packages/${pkg.name}/src
    RUN cd /app/packages/${pkg.name} && npm run prepare
  `);
});

add("# build everyone's production dependencies into one big blob");
add("FROM base");
add(
  "RUN " +
    [
      // clear out dev dependencies, we don't want em
      "find . -maxdepth 3 -type f -name package.json -exec sed -i s/devDependencies/devDependenciesRemoved/ {} \\;",
      "yarn install --prod",
      "yarn cache clean"
    ].join(" && ")
);

buildPackages.forEach(pkg => {
  const distDir = pkg.main.split("/")[0];
  add(
    `COPY --from=${pkg.containerName} /app/packages/${
      pkg.name
    }/${distDir} /app/packages/${pkg.name}/${distDir}`
  );
});

fs.writeFileSync(
  path.resolve(__dirname, "..", "Dockerfile"),
  output.join("\n") + "\n",
  "utf8"
);
