const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(context) {
  if (context.packager.platform.name !== 'mac') return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );

  console.log(`  • deep adhoc signing  app=${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`);
};
