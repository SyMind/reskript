import path from 'path';
import {logger, isMonorepo, normalizeRuleMatch} from '@reskript/core';
import {SettingsPlugin} from '@reskript/settings';
import {Options, PackageInfo} from './interface';
import {resolveParticipant, findSiblingPackages, buildPackageInfo, buildPeerAlias, checkDependencyGraph} from './utils';

export default (options: Options = {}): SettingsPlugin => (settings, {cwd}) => {
    if (!isMonorepo(cwd)) {
        logger.error('Current project is not a monorepo workspace');
        process.exit(24);
    }

    const self = buildPackageInfo(cwd);
    const siblings = findSiblingPackages(cwd, self);
    const isDependencyOfSelf = ({name}: PackageInfo) => !!(self.dependencies[name] ?? self.devDependencies[name]);
    const includedSiblings = resolveParticipant(siblings.filter(isDependencyOfSelf), options);

    const dependencyGraphChecked = checkDependencyGraph(includedSiblings, self);

    if (!dependencyGraphChecked) {
        process.exit(24);
    }

    const incomingBabelFilter = normalizeRuleMatch(cwd, settings.build.script.babel);
    const incomingModulesFilter = normalizeRuleMatch(cwd, settings.build.style.modules);
    const includedSiblingDirectories = includedSiblings.map(v => v.directory);
    return {
        ...settings,
        build: {
            ...settings.build,
            style: options.styles
                ? {
                    ...settings.build.style,
                    modules: (resource: string) => {
                        const shouldProcess = incomingModulesFilter(resource);
                        return shouldProcess || includedSiblingDirectories.some(v => resource.startsWith(v));
                    },
                }
                : settings.build.style,
            script: {
                ...settings.build.script,
                babel: (resource: string) => {
                    const shouldProcess = incomingBabelFilter(resource);
                    return shouldProcess || includedSiblingDirectories.some(v => resource.startsWith(v));
                },
            },
            finalize: (config, env, internals) => {
                const before = settings.build.finalize(config, env, internals);
                // 因为`peerDependencies`里也会包含本地的包，所以要先处理这些东西，再用下面的`for`循环把本地包的规则覆盖上去就对了
                Object.assign(
                    before.resolve?.alias,
                    buildPeerAlias(cwd, includedSiblings)
                );
                for (const {name, directory} of includedSiblings) {
                    Object.assign(
                        before.resolve?.alias,
                        {[`${name}`]: path.join(directory, 'src')}
                    );
                }
                return before;
            },
        },
    };
};