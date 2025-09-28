import archiver from 'archiver';
// Using native FormData (Node.js 18+) as recommended by PocketBase maintainer
import fs from 'fs';
import path from 'path';
import { stat, access, readFile, readdir } from 'fs/promises';
import { createWriteStream } from 'fs';
import { debug, errorWithTimestamp } from '../utils/debug.js';
import { loadToken } from '../utils/config.js';
import { saveDeployConfig, updateDeployState, loadDeployConfig } from '../utils/deploy-config.js';
import { createSpinner } from '../utils/terminal-spinner.js';

const RELAIS_API_URL = 'https://relais.dev';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes

export class DeployService {
  
  /**
   * Parse .gitignore file and create file filter function
   * @param {string} folderPath - Path to the folder to deploy
   * @param {string} archiveBasename - Basename of the generated archive to exclude
   * @param {string} deployType - Type of deployment to add specific ignores
   */
  async createFileFilter(folderPath, archiveBasename, deployType = 'web') {
    const ignorePatterns = [];
    
    // Always ignore relais.json, all tar.gz files, and .git directory
    ignorePatterns.push('relais.json');
    ignorePatterns.push('*.tar.gz'); // Ignore all tar.gz files
    ignorePatterns.push('.git/'); // Ignore git directory
    if (archiveBasename) {
      ignorePatterns.push(archiveBasename);
    }
    
    // No deployment type-specific ignores needed for current types
    
    // Try to read .gitignore file
    const gitignorePath = path.join(folderPath, '.gitignore');
    try {
      debug('Reading .gitignore from:', gitignorePath);
      const gitignoreContent = await readFile(gitignorePath, 'utf-8');
      debug('Raw .gitignore content length:', gitignoreContent.length);
      const lines = gitignoreContent.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#')); // Remove empty lines and comments
      ignorePatterns.push(...lines);
      debug('Loaded .gitignore patterns:', lines);
      debug('Total patterns after .gitignore:', ignorePatterns.length);
    } catch (error) {
      debug('No .gitignore file found or could not read it:', error.message);
    }
    
    debug('All ignore patterns:', ignorePatterns);
    
    // Create filter function
    return (filePath, relativePath) => {
      // Convert absolute path to relative path from folder root
      const relPath = path.relative(folderPath, filePath);
      
      // Check against ignore patterns
      for (const pattern of ignorePatterns) {
        if (this.matchesIgnorePattern(relPath, pattern)) {
          debug('✗ Filtering out:', relPath, 'matches pattern:', pattern);
          return false;
        }
      }
      
      return true;
    };
  }
  
  /**
   * Check if a file path matches a gitignore pattern
   * @param {string} filePath - Relative file path to check
   * @param {string} pattern - Gitignore pattern to match against
   */
  matchesIgnorePattern(filePath, pattern) {
    // Normalize path separators for cross-platform compatibility
    const normalizedPath = filePath.replace(/\\/g, '/');
    const normalizedPattern = pattern.replace(/\\/g, '/');
    
    debug(`Testing path "${normalizedPath}" against pattern "${normalizedPattern}"`);
    
    // Handle directory patterns (ending with /)
    if (normalizedPattern.endsWith('/')) {
      const dirPattern = normalizedPattern.slice(0, -1);
      // Check if path is the directory itself or inside it
      const matches = normalizedPath === dirPattern || 
                     normalizedPath.startsWith(dirPattern + '/');
      debug(`Directory pattern "${normalizedPattern}": ${matches ? 'MATCH' : 'NO MATCH'}`);
      return matches;
    }
    
    // Handle wildcard patterns
    if (normalizedPattern.includes('*')) {
      // Convert gitignore pattern to regex
      let regexPattern = normalizedPattern
        .replace(/\./g, '\\.')  // Escape dots
        .replace(/\*\*/g, '@@DOUBLESTAR@@')  // Temporarily replace **
        .replace(/\*/g, '[^/]*')  // * matches anything except /
        .replace(/@@DOUBLESTAR@@/g, '.*')  // ** matches anything including /
        .replace(/\?/g, '[^/]');  // ? matches single char except /
      
      const regex = new RegExp('^' + regexPattern + '$');
      const matches = regex.test(normalizedPath);
      debug(`Wildcard pattern "${normalizedPattern}" -> regex "${regexPattern}": ${matches ? 'MATCH' : 'NO MATCH'}`);
      return matches;
    }
    
    // Handle leading slash patterns (root-relative)
    if (normalizedPattern.startsWith('/')) {
      const rootPattern = normalizedPattern.slice(1); // Remove leading slash
      const matches = normalizedPath === rootPattern || 
                     normalizedPath.startsWith(rootPattern + '/');
      debug(`Root-relative pattern "${normalizedPattern}": ${matches ? 'MATCH' : 'NO MATCH'}`);
      return matches;
    }
    
    // Exact match or directory content match
    const matches = normalizedPath === normalizedPattern || 
                   normalizedPath.startsWith(normalizedPattern + '/') ||
                   path.basename(normalizedPath) === normalizedPattern;
    debug(`Exact/basename pattern "${normalizedPattern}": ${matches ? 'MATCH' : 'NO MATCH'}`);
    return matches;
  }
  
  /**
   * Deploy a folder by creating a tar.gz archive and uploading to PocketBase
   * @param {string} folderPath - Path to the folder to deploy
   * @param {string} type - Deployment type (default: 'web')
   * @param {boolean} isUpdate - Whether this is an update to existing deployment
   * @param {string} domain - Custom domain for deployment (optional)
   */
  async deploy(folderPath, type = 'web', isUpdate = false, domain = undefined) {
    let archivePath = null;
    const spinners = [];
    
    try {
      // Validate deployment type
      const allowedTypes = new Set(['web', 'react', 'static', 'node', 'nest']);
      if (!allowedTypes.has(type)) {
        throw new Error(`Invalid deployment type: ${type}. Allowed types: web, react, static, node, nest`);
      }

      // Validate folder exists
      const sValidate = createSpinner('Validating folder').start();
      spinners.push(sValidate);
      await this.validateFolder(folderPath, type);
      sValidate.succeed('Folder validated');
      
      // Create tar.gz file
      const sArchive = createSpinner('Creating archive').start();
      spinners.push(sArchive);
      archivePath = await this.createTarGz(folderPath, type);
      sArchive.succeed('Archive created');
      
      // Validate archive file size
      const sSize = createSpinner('Validating archive size').start();
      spinners.push(sSize);
      await this.validateArchiveSize(archivePath);
      sSize.succeed('Archive size validated');
      
      let result;
      if (isUpdate) {
        // Load existing config to get the deployment ID
        const existingConfig = await loadDeployConfig();
        if (!existingConfig || !existingConfig.id) {
          throw new Error('Cannot update: No existing deployment found');
        }
        
        // Update existing deployment
        const sUpload = createSpinner('Uploading update to Relais').start();
        spinners.push(sUpload);
        result = await this.updateDeployment(existingConfig.id, archivePath, type, domain);
        sUpload.succeed('Update uploaded');
        debug('Updated existing deployment');
      } else {
        // Create new deployment
        const sUpload = createSpinner('Uploading deployment to Relais').start();
        spinners.push(sUpload);
        result = await this.uploadToPocketBase(archivePath, type, domain);
        sUpload.succeed('Deployment uploaded');
        debug('Created new deployment');
      }
      
      // Save deployment configuration
      const sConfig = createSpinner('Saving deployment configuration').start();
      spinners.push(sConfig);
      await saveDeployConfig({
        id: result.id,
        folder: folderPath,
        type: type,
        state: 'UPLOADING',
        file: result.file,
        domain: domain || null
      });
      sConfig.succeed('Deployment configuration saved');
      
      return result;
      
    } catch (error) {
      // Fail any active spinners
      for (const s of spinners) {
        if (s && s.active) s.fail();
      }
      errorWithTimestamp('Deploy failed:', error.message);
      throw error;
    } finally {
      // Always clean up temporary archive file, even if there was an error
      if (archivePath) {
        await this.cleanup(archivePath);
      }
    }
  }
  
  /**
   * Validate that the folder exists and is accessible
   * For Node.js and Next.js deployments, also validate that package.json exists
   */
  async validateFolder(folderPath, type = 'web') {
    try {
      await access(folderPath);
      const stats = await stat(folderPath);
      
      if (!stats.isDirectory()) {
        throw new Error(`${folderPath} is not a directory`);
      }
      
      // For Node.js and NestJS deployments, check that package.json exists
      if (type === 'node' || type === 'nest') {
        const packageJsonPath = path.join(folderPath, 'package.json');
        try {
          await access(packageJsonPath);
          debug(`package.json validation passed for ${type} deployment`);
        } catch (error) {
          throw new Error(`${type} deployment requires a package.json file in the project folder`);
        }
      }
      
      debug('Folder validation passed:', folderPath);
    } catch (error) {
      throw new Error(`Cannot access folder: ${folderPath} - ${error.message}`);
    }
  }
  
  /**
   * Create a tar.gz file from the specified folder with gitignore filtering
   */
  async createTarGz(folderPath, type = 'web') {
    return new Promise(async (resolve, reject) => {
      try {
        const folderName = path.basename(folderPath);
        const tarGzPath = path.join(process.cwd(), `${folderName}-${Date.now()}.tar.gz`);
        
        debug('Creating tar.gz file:', tarGzPath);
        
        // Create file filter
        const archiveBasename = path.basename(tarGzPath);
        const fileFilter = await this.createFileFilter(folderPath, archiveBasename, type);
        
        const output = createWriteStream(tarGzPath);
        const archive = archiver('tar', {
          gzip: true,
          gzipOptions: {
            level: 9, // Maximum compression
            memLevel: 9
          }
        });
        
        output.on('close', () => {
          debug(`Tar.gz created successfully: ${archive.pointer()} bytes`);
          resolve(tarGzPath);
        });
        
        archive.on('error', (err) => {
          reject(new Error(`Tar.gz creation failed: ${err.message}`));
        });
        
        archive.pipe(output);
        
        // Add files with filtering instead of entire directory
        await this.addFilteredFiles(archive, folderPath, fileFilter);
        
        archive.finalize();
      } catch (error) {
        reject(error);
      }
    });
  }
  
  /**
   * Recursively add files to archive with filtering
   * @param {*} archive - Archiver instance
   * @param {string} folderPath - Root folder path
   * @param {Function} fileFilter - Filter function
   * @param {string} currentPath - Current directory being processed
   */
  async addFilteredFiles(archive, folderPath, fileFilter, currentPath = folderPath) {
    try {
      const entries = await readdir(currentPath, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        const relativePath = path.relative(folderPath, fullPath);
        
        if (entry.isDirectory()) {
          // For directories, check if the directory itself should be ignored
          if (!fileFilter(fullPath)) {
            debug('✗ Skipping directory:', relativePath);
            continue; // Skip entire directory and all its contents
          }
          // If directory is not ignored, recursively process its contents
          await this.addFilteredFiles(archive, folderPath, fileFilter, fullPath);
        } else if (entry.isFile()) {
          // For files, check if the file should be included
          if (!fileFilter(fullPath)) {
            continue; // Skip this file
          }
          // Add file to archive
          archive.file(fullPath, { name: relativePath });
          debug('Added file to archive:', relativePath);
        }
      }
    } catch (error) {
      throw new Error(`Failed to process directory ${currentPath}: ${error.message}`);
    }
  }
  
  /**
   * Validate that the archive file doesn't exceed the size limit
   */
  async validateArchiveSize(archivePath) {
    try {
      const stats = await stat(archivePath);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
      debug(`Archive file size: ${sizeInMB}MB`);
      if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`Archive file too large: ${sizeInMB}MB (max: 50MB)`);
      }
    } catch (error) {
      throw new Error(`Size validation failed: ${error.message}`);
    }
  }
  
  /**
   * Upload the tar.gz file to PocketBase
   */
  async uploadToPocketBase(archivePath, type, domain) {
    try {
      // Load user token
      const token = await loadToken();
      
      // Verify archive file exists and read as buffer to avoid stream issues
      try {
        await access(archivePath);
      } catch (error) {
        throw new Error(`Archive file not found: ${archivePath}`);
      }
      
      const archiveBuffer = await readFile(archivePath);
      const archiveFileName = path.basename(archivePath);
      
      // Validate buffer was read successfully
      if (!archiveBuffer || archiveBuffer.length === 0) {
        throw new Error('Archive file is empty or could not be read');
      }
      
      // Use native FormData and Blob as recommended by PocketBase maintainer
      const formData = new FormData();
      
      // Convert buffer to Blob for proper multipart handling
      const fileBlob = new Blob([archiveBuffer], { type: 'application/gzip' });
      
      // Add form fields using native FormData
      formData.append('file', fileBlob, archiveFileName);
      formData.append('type', type);
      formData.append('token', token);
      if (domain) formData.append('domain', domain);
      
      debug('Uploading to PocketBase...', {
        url: `${RELAIS_API_URL}/api/collections/deploy_rc/records`,
        fileName: archiveFileName,
        type,
        fileSize: archiveBuffer.length,
        hasToken: !!token,
        domain,
      });
      
      const response = await fetch(`${RELAIS_API_URL}/api/collections/deploy_rc/records`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        let errorText;
        let errorDetails = {};
        try {
          errorText = await response.text();
          try {
            errorDetails = JSON.parse(errorText);
            debug('PocketBase error details:', errorDetails);
          } catch (parseError) {
            debug('Could not parse error response as JSON:', errorText);
          }
        } catch (e) {
          errorText = 'Could not read error response';
        }
        throw new Error(`Upload failed: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      debug('Upload successful:', result);
      
      return {
        success: true,
        id: result.id,
        file: result.file,
        message: 'Deployment uploaded successfully'
      };
      
    } catch (error) {
      throw new Error(`PocketBase upload failed: ${error.message}`);
    }
  }
  
  /**
   * Update an existing deployment with new tar.gz file
   * @param {string} deploymentId - The existing deployment ID
   * @param {string} archivePath - Path to the new tar.gz file
   * @param {string} type - Deployment type
   * @param {string} domain - Custom domain for deployment (optional)
   */
  async updateDeployment(deploymentId, archivePath, type, domain) {
    try {
      // Load user token
      const token = await loadToken();
      
      // Verify archive file exists and read as buffer
      try {
        await access(archivePath);
      } catch (error) {
        throw new Error(`Archive file not found: ${archivePath}`);
      }
      
      const archiveBuffer = await readFile(archivePath);
      const archiveFileName = path.basename(archivePath);
      
      // Validate buffer was read successfully
      if (!archiveBuffer || archiveBuffer.length === 0) {
        throw new Error('Archive file is empty or could not be read');
      }
      
      // Use native FormData and Blob for update
      const formData = new FormData();
      
      // Convert buffer to Blob for proper multipart handling
      const fileBlob = new Blob([archiveBuffer], { type: 'application/gzip' });
      
      // Add form fields using native FormData
      formData.append('file', fileBlob, archiveFileName);
      formData.append('type', type);
      formData.append('token', token);
      if (domain) formData.append('domain', domain);
      
      debug('Updating deployment in PocketBase...', {
        url: `${RELAIS_API_URL}/api/collections/deploy_rc/records/${deploymentId}`,
        fileName: archiveFileName,
        type,
        fileSize: archiveBuffer.length,
        deploymentId,
        domain,
      });
      
      const response = await fetch(`${RELAIS_API_URL}/api/collections/deploy_rc/records/${deploymentId}`, {
        method: 'PATCH',
        body: formData,
      });
      
      if (!response.ok) {
        let errorText;
        let errorDetails = {};
        try {
          errorText = await response.text();
          try {
            errorDetails = JSON.parse(errorText);
            debug('PocketBase update error details:', errorDetails);
          } catch (parseError) {
            debug('Could not parse error response as JSON:', errorText);
          }
        } catch (e) {
          errorText = 'Could not read error response';
        }
        throw new Error(`Update failed: ${response.status} - ${errorText}`);
      }
      
      const result = await response.json();
      debug('Update successful:', result);
      
      return {
        success: true,
        id: result.id,
        file: result.file,
        message: 'Deployment updated successfully'
      };
      
    } catch (error) {
      throw new Error(`PocketBase update failed: ${error.message}`);
    }
  }
  
  /**
   * Poll deployment status until completion
   * @param {string} deploymentId - The deployment ID to check
   */
  async pollDeploymentStatus(deploymentId) {
    let hasShownProcessing = false;
    let hasShownPending = false;
    const statusSpinner = createSpinner('Waiting for deployment status').start();
    
    return new Promise((resolve, reject) => {
      const checkStatus = async () => {
        try {
          const response = await fetch(`${RELAIS_API_URL}/relais/info/${deploymentId}`);
          
          if (!response.ok) {
            reject(new Error(`Status check failed: ${response.status}`));
            return;
          }
          
          const status = await response.json();
          debug('Deployment status:', status);
          
          switch (status.state) {
            case 'DEPLOYED':
              statusSpinner.succeed(`Project deployed: https://${status.domain}`);
              await updateDeployState('DEPLOYED', status.domain);
              resolve(status);
              return;
              
            case 'FAILED':
              statusSpinner.fail('Deployment failed');
              errorWithTimestamp(`❌ Deployment failed: ${status.error || 'Unknown error'}`);
              await updateDeployState('FAILED');
              reject(new Error(`Deployment failed: ${status.error || 'Unknown error'}`));
              return;
              
            case 'PROCESSING':
              if (!hasShownProcessing) {
                statusSpinner.update('Deployment processing...');
                await updateDeployState('PROCESSING');
                hasShownProcessing = true;
              }
              break;
              
            case 'PENDING':
              if (!hasShownPending) {
                statusSpinner.update('Deployment pending...');
                await updateDeployState('PENDING');
                hasShownPending = true;
              }
              break;
              
            default:
              statusSpinner.update(`Deployment state: ${status.state}`);
              break;
          }
          
          // Continue polling after 1 second
          setTimeout(checkStatus, 1000);
          
        } catch (error) {
          statusSpinner.fail('Status check error');
          reject(new Error(`Status check error: ${error.message}`));
        }
      };
      
      // Start polling immediately
      checkStatus();
    });
  }
  
  /**
   * Clean up temporary files
   */
  async cleanup(archivePath) {
    try {
      await fs.promises.unlink(archivePath);
      debug('Temporary archive file cleaned up:', archivePath);
    } catch (error) {
      debug('Cleanup warning:', error.message);
      // Don't throw error for cleanup failures
    }
  }
}

export const deployService = new DeployService(); 