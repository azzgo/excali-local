import * as fs from 'fs';
import * as path from 'path';
import * as glob from 'glob';

const rootPackagePath = path.join(__dirname, '../package.json');

const syncVersions = () => {
  try {
    const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));

    if (rootPackage.workspaces && Array.isArray(rootPackage.workspaces)) {
      const workspacePaths = rootPackage.workspaces.flatMap((workspaceGlob: string) =>
        glob.sync(workspaceGlob, { cwd: path.join(__dirname, '../') })
      );

      workspacePaths.forEach((workspaceRelativePath: string) => {
        const workspacePackagePath = path.join(__dirname, '../', workspaceRelativePath, 'package.json');
        if (fs.existsSync(workspacePackagePath)) {
          const workspacePackage = JSON.parse(fs.readFileSync(workspacePackagePath, 'utf8'));

          if (workspacePackage.version !== rootPackage.version) {
            workspacePackage.version = rootPackage.version;
            fs.writeFileSync(workspacePackagePath, JSON.stringify(workspacePackage, null, 2), 'utf8');
            console.log(`Synchronized version in ${workspaceRelativePath} to ${workspacePackage.version}`);
          } else {
            console.log(`Versions in ${workspaceRelativePath} are already synchronized`);
          }
        } else {
          console.warn(`Workspace package.json not found at ${workspacePackagePath}`);
        }
      });
    } else {
      console.error('No workspaces defined in root package.json');
    }
  } catch (error) {
    console.error('Error synchronizing versions:', error);
  }
};

syncVersions();

