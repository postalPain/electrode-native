// @flow

import {
  cauldron,
  MiniApp
} from 'ern-core'
import {
  Dependency,
  DependencyPath,
  NativeApplicationDescriptor
} from 'ern-util'
import {
  runCauldronContainerGen
} from '../../../lib/publication'
import utils from '../../../lib/utils'
import inquirer from 'inquirer'
import semver from 'semver'
import _ from 'lodash'

exports.command = 'miniapp'
exports.desc = 'Update version(s) of one or more MiniApp(s) in the Cauldron'

exports.builder = function (yargs: any) {
  return yargs
  .option('force', {
    alias: 'f',
    type: 'bool',
    describe: 'Force'
  })
  .option('ignoreNpmPublish', {
    alias: 'i',
    type: 'bool',
    describe: 'Ignore npm publication step'
  })
  .option('containerVersion', {
    alias: 'v',
    type: 'string',
    describe: 'Version to use for generated container. If none provided, patch version will be bumped by default.'
  })
  .option('miniapps', {
    type: 'array',
    alias: 'm',
    describe: 'A list of one or more miniapps'
  })
  .option('descriptor', {
    type: 'string',
    alias: 'd',
    describe: 'A complete native application descriptor'
  })
}

// Most/All of the logic here should be moved to the MiniApp class
// Commands should remain as much logic less as possible
exports.handler = async function ({
  miniapps,
  descriptor,
  force = false,
  ignoreNpmPublish = false,
  containerVersion
} : {
  miniapps?: Array<string>,
  descriptor: string,
  force: boolean,
  ignoreNpmPublish: boolean,
  containerVersion?: string
}) {
  await utils.logErrorAndExitIfNotSatisfied({
    isCompleteNapDescriptorString: descriptor,
    napDescriptorExistInCauldron: descriptor,
    isValidContainerVersion: containerVersion,
    noGitOrFilesystemPath: miniapps
  })

  //
  // Construct MiniApp objects array
  let miniAppsObjs = []
  if (miniapps) {
    const miniAppsDependencyPaths = _.map(miniapps, m => DependencyPath.fromString(m))
    for (const miniAppDependencyPath of miniAppsDependencyPaths) {
      const m = await MiniApp.fromPackagePath(miniAppDependencyPath)
      miniAppsObjs.push(m)
    }
  } else {
    log.info(`No MiniApps were explicitly provided. Assuming that this command is run from within a MiniApp directory`)
    miniAppsObjs = [ MiniApp.fromCurrentPath() ]
  }

  //
  // If the 'ignoreNpmPublish' flag was not provided, ensure that all
  // MiniApps versions have been published to NPM
  if (!ignoreNpmPublish) {
    log.info(`Ensuring that MiniApp(s) versions have been published to NPM`)
    for (const miniAppObj of miniAppsObjs) {
      if (!await miniAppObj.isPublishedToNpm()) {
        const {publishToNpm} = await inquirer.prompt({
          type: 'confirm',
          name: 'publishToNpm',
          message: `${miniAppObj.packageJson.name} MiniApp version ${miniAppObj.version} is not published to npm. Do you want to publish it ?`,
          default: true
        })
        if (publishToNpm) {
          log.info(`Publishing ${miniAppObj.packageJson.name} MiniApp version ${miniAppObj.version} to npm`)
          miniAppObj.publishToNpm()
        } else {
          return log.error(`Sorry you cannot add a MiniApp version that was not published to NPM to the Cauldron.`)
        }
      }
    }
  }

  if (!descriptor) {
    descriptor = await utils.askUserToChooseANapDescriptorFromCauldron({ onlyNonReleasedVersions: true })
  }

  const napDescriptor = NativeApplicationDescriptor.fromString(descriptor)

  //
  // Make sure that MiniApp(s) exist in the native application version
  // and that their versions are different than the ones to update to
  const miniAppsAsDependencies = _.map(miniapps, m => Dependency.fromString(m))
  for (const miniAppAsDependency of miniAppsAsDependencies) {
    const versionLessMiniAppDependencyString = miniAppAsDependency.withoutVersion().toString()
    const miniApp = await cauldron.getContainerMiniApp(napDescriptor, versionLessMiniAppDependencyString)
    if (!miniApp) {
      return log.error(`${versionLessMiniAppDependencyString} MiniApp does not exist in ${napDescriptor.toString()}`)
    }
    if (Dependency.fromString(miniApp).version === miniAppAsDependency.version) {
      return log.error(`${versionLessMiniAppDependencyString} MiniApp is already at version ${miniAppAsDependency.version}`)
    }
  }

  try {
    // Begin a Cauldron transaction
    await cauldron.beginTransaction()

    for (const miniAppObj of miniAppsObjs) {
       // Add the MiniApp (and all it's dependencies if needed) to Cauldron
      await miniAppObj.addToNativeAppInCauldron(napDescriptor, force)
    }

    // Set the container version to use for container generation
    let cauldronContainerVersion
    if (containerVersion) {
      log.debug(`Using user provided container version : ${containerVersion}`)
      cauldronContainerVersion = containerVersion
    } else {
      cauldronContainerVersion = await cauldron.getContainerVersion(napDescriptor)
      cauldronContainerVersion = semver.inc(cauldronContainerVersion, 'patch')
      log.debug(`Bumping container version from cauldron : ${cauldronContainerVersion}`)
    }

    // Run container generator
    await runCauldronContainerGen(
      napDescriptor,
      cauldronContainerVersion,
      { publish: true })

    // Update container version in Cauldron
    await cauldron.updateContainerVersion(napDescriptor, cauldronContainerVersion)

    // Commit Cauldron transaction
    await cauldron.commitTransaction()

    log.info(`MiniApp(s) version(s) was/were succesfully updated for ${napDescriptor.toString()} in Cauldron !`)
    log.info(`Published new container version ${cauldronContainerVersion} for ${napDescriptor.toString()}`)
  } catch (e) {
    log.error(`An error occured while trying to update MiniApp(s) version(s) in Cauldron`)
    cauldron.discardTransaction()
  }
}
