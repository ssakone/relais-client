import archiver from 'archiver';
// Using native FormData (Node.js 18+) as recommended by PocketBase maintainer
import fs from 'fs';
import path from 'path';
import { stat, access, readFile } from 'fs/promises';
import { createWriteStream } from 'fs';
import { debug, errorWithTimestamp } from '../utils/debug.js';
import { loadToken } from '../utils/config.js';
import { saveDeployConfig, updateDeployState, loadDeployConfig } from '../utils/deploy-config.js';

const RELAIS_API_URL = 'https://relais.dev';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes

export class DeployService {
  
  /**
   * Deploy a folder by zipping it and uploading to PocketBase
   * @param {string} folderPath - Path to the folder to deploy
   * @param {string} type - Deployment type (default: 'web')
   * @param {boolean} isUpdate - Whether this is an update to existing deployment
   * @param {string} domain - Custom domain for deployment (optional)
   */
  async deploy(folderPath, type = 'web', isUpdate = false, domain = undefined) {
    let zipPath = null;
    
    try {
      // Validate folder exists
      await this.validateFolder(folderPath);
      
      // Create zip file
      zipPath = await this.createZip(folderPath);
      
      // Validate zip file size
      await this.validateZipSize(zipPath);
      
      let result;
      if (isUpdate) {
        // Load existing config to get the deployment ID
        const existingConfig = await loadDeployConfig();
        if (!existingConfig || !existingConfig.id) {
          throw new Error('Cannot update: No existing deployment found');
        }
        
        // Update existing deployment
        result = await this.updateDeployment(existingConfig.id, zipPath, type, domain);
        console.log('🔄 Updated existing deployment');
      } else {
        // Create new deployment
        result = await this.uploadToPocketBase(zipPath, type, domain);
        console.log('🆕 Created new deployment');
      }
      
      // Save deployment configuration
      await saveDeployConfig({
        id: result.id,
        folder: folderPath,
        type: type,
        state: 'UPLOADING',
        file: result.file,
        domain: domain || null
      });
      
      return result;
      
    } catch (error) {
      errorWithTimestamp('Deploy failed:', error.message);
      throw error;
    } finally {
      // Always clean up temporary zip file, even if there was an error
      if (zipPath) {
        await this.cleanup(zipPath);
      }
    }
  }
  
  /**
   * Validate that the folder exists and is accessible
   */
  async validateFolder(folderPath) {
    try {
      await access(folderPath);
      const stats = await stat(folderPath);
      
      if (!stats.isDirectory()) {
        throw new Error(`${folderPath} is not a directory`);
      }
      
      debug('Folder validation passed:', folderPath);
    } catch (error) {
      throw new Error(`Cannot access folder: ${folderPath} - ${error.message}`);
    }
  }
  
  /**
   * Create a zip file from the specified folder
   */
  async createZip(folderPath) {
    return new Promise((resolve, reject) => {
      const folderName = path.basename(folderPath);
      const zipPath = path.join(process.cwd(), `${folderName}-${Date.now()}.zip`);
      
      debug('Creating zip file:', zipPath);
      
      const output = createWriteStream(zipPath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Maximum compression
      });
      
      output.on('close', () => {
        debug(`Zip created successfully: ${archive.pointer()} bytes`);
        resolve(zipPath);
      });
      
      archive.on('error', (err) => {
        reject(new Error(`Zip creation failed: ${err.message}`));
      });
      
      archive.pipe(output);
      archive.directory(folderPath, folderName);
      archive.finalize();
    });
  }
  
  /**
   * Validate that the zip file doesn't exceed the size limit
   */
  async validateZipSize(zipPath) {
    try {
      const stats = await stat(zipPath);
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      debug(`Zip file size: ${sizeInMB}MB`);
      
      if (stats.size > MAX_FILE_SIZE) {
        throw new Error(`Zip file too large: ${sizeInMB}MB (max: 10MB)`);
      }
    } catch (error) {
      throw new Error(`Size validation failed: ${error.message}`);
    }
  }
  
  /**
   * Upload the zip file to PocketBase
   */
  async uploadToPocketBase(zipPath, type, domain) {
    try {
      // Load user token
      const token = await loadToken();
      
      // Verify zip file exists and read as buffer to avoid stream issues
      try {
        await access(zipPath);
      } catch (error) {
        throw new Error(`Zip file not found: ${zipPath}`);
      }
      
      const zipBuffer = await readFile(zipPath);
      const zipFileName = path.basename(zipPath);
      
      // Validate buffer was read successfully
      if (!zipBuffer || zipBuffer.length === 0) {
        throw new Error('Zip file is empty or could not be read');
      }
      
      // Use native FormData and Blob as recommended by PocketBase maintainer
      const formData = new FormData();
      
      // Convert buffer to Blob for proper multipart handling
      const fileBlob = new Blob([zipBuffer], { type: 'application/zip' });
      
      // Add form fields using native FormData
      formData.append('file', fileBlob, zipFileName);
      formData.append('type', type);
      formData.append('token', token);
      if (domain) formData.append('domain', domain);
      
      debug('Uploading to PocketBase...', {
        url: `${RELAIS_API_URL}/api/collections/deploy_rc/records`,
        fileName: zipFileName,
        type,
        fileSize: zipBuffer.length,
        hasToken: !!token,
        token,
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
   * Update an existing deployment with new zip file
   * @param {string} deploymentId - The existing deployment ID
   * @param {string} zipPath - Path to the new zip file
   * @param {string} type - Deployment type
   * @param {string} domain - Custom domain for deployment (optional)
   */
  async updateDeployment(deploymentId, zipPath, type, domain) {
    try {
      // Load user token
      const token = await loadToken();
      
      // Verify zip file exists and read as buffer
      try {
        await access(zipPath);
      } catch (error) {
        throw new Error(`Zip file not found: ${zipPath}`);
      }
      
      const zipBuffer = await readFile(zipPath);
      const zipFileName = path.basename(zipPath);
      
      // Validate buffer was read successfully
      if (!zipBuffer || zipBuffer.length === 0) {
        throw new Error('Zip file is empty or could not be read');
      }
      
      // Use native FormData and Blob for update
      const formData = new FormData();
      
      // Convert buffer to Blob for proper multipart handling
      const fileBlob = new Blob([zipBuffer], { type: 'application/zip' });
      
      // Add form fields using native FormData
      formData.append('file', fileBlob, zipFileName);
      formData.append('type', type);
      formData.append('token', token);
      if (domain) formData.append('domain', domain);
      
      debug('Updating deployment in PocketBase...', {
        url: `${RELAIS_API_URL}/api/collections/deploy_rc/records/${deploymentId}`,
        fileName: zipFileName,
        type,
        fileSize: zipBuffer.length,
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
              console.log(`🚀 Project deployed! Accessible via: https://${status.domain}`);
              await updateDeployState('DEPLOYED', status.domain);
              resolve(status);
              return;
              
            case 'FAILED':
              console.log(`❌ Deployment failed: ${status.error || 'Unknown error'}`);
              await updateDeployState('FAILED');
              reject(new Error(`Deployment failed: ${status.error || 'Unknown error'}`));
              return;
              
            case 'PROCESSING':
              if (!hasShownProcessing) {
                console.log('⏳ Deployment is processing...');
                await updateDeployState('PROCESSING');
                hasShownProcessing = true;
              }
              break;
              
            case 'PENDING':
              if (!hasShownPending) {
                console.log('⏳ Deployment is pending...');
                await updateDeployState('PENDING');
                hasShownPending = true;
              }
              break;
              
            default:
              debug('Unknown deployment state:', status.state);
              break;
          }
          
          // Continue polling after 1 second
          setTimeout(checkStatus, 1000);
          
        } catch (error) {
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
  async cleanup(zipPath) {
    try {
      await fs.promises.unlink(zipPath);
      debug('Temporary zip file cleaned up:', zipPath);
    } catch (error) {
      debug('Cleanup warning:', error.message);
      // Don't throw error for cleanup failures
    }
  }
}

export const deployService = new DeployService(); 