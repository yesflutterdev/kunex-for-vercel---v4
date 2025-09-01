const mongoose = require('mongoose');
const Folder = require('../models/folder.model');
const Favorite = require('../models/favorite.model');
const {
  validateFolder,
  validateFolderUpdate,
  validateGetFolders,
  validateFolderSearch,
  validateFolderReorder
} = require('../utils/favoritesValidation');

// Create new folder (KON-35)
exports.createFolder = async (req, res, next) => {
  try {
    const { error, value } = validateFolder(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { name, description, color, icon, isPublic, sortOrder, metadata } = value;

    // Check if folder name already exists for user
    const existingFolder = await Folder.findOne({ userId, name });
    if (existingFolder) {
      return res.status(409).json({
        success: false,
        message: 'Folder with this name already exists',
      });
    }

    // Create folder
    const folder = new Folder({
      userId,
      name,
      description,
      color,
      icon,
      isPublic,
      sortOrder,
      metadata
    });

    await folder.save();

    res.status(201).json({
      success: true,
      message: 'Folder created successfully',
      data: { folder },
    });
  } catch (error) {
    next(error);
  }
};

// Get user's folders
exports.getFolders = async (req, res, next) => {
  try {
    const { error, value } = validateGetFolders(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { includeEmpty, sortBy, limit, category } = value;

    // Build query options
    const options = { includeEmpty, sortBy, limit };

    // Get folders
    let folders = await Folder.getUserFolders(userId, options);

    // Filter by category if specified
    if (category) {
      folders = folders.filter(folder => folder.metadata?.category === category);
    }

    // Get favorite counts for each folder
    const folderCounts = await Favorite.getFavoriteCountsByFolder(userId);
    const countMap = new Map(folderCounts.map(item => [item.folderId.toString(), item.count]));

    // Add counts to folders
    folders = folders.map(folder => ({
      ...folder,
      itemCount: countMap.get(folder._id.toString()) || 0
    }));

    res.status(200).json({
      success: true,
      data: {
        folders,
        totalCount: folders.length,
        appliedFilters: {
          includeEmpty,
          category,
          sortBy
        }
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get single folder details
exports.getFolder = async (req, res, next) => {
  try {
    const { folderId } = req.params;
    const userId = req.user.id;

    const folder = await Folder.findOne({ _id: folderId, userId }).lean();
    if (!folder) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found',
      });
    }

    // Get favorites count and recent favorites
    const [favoriteCount, recentFavorites] = await Promise.all([
      Favorite.countDocuments({ folderId, userId }),
      Favorite.find({ folderId, userId })
        .populate({
          path: 'businessId',
          select: 'businessName logo industry location'
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
    ]);

    // Update last accessed
    await Folder.findByIdAndUpdate(folderId, {
      $set: { 'metadata.lastAccessed': new Date() }
    });

    res.status(200).json({
      success: true,
      data: {
        folder: {
          ...folder,
          itemCount: favoriteCount
        },
        recentFavorites
      },
    });
  } catch (error) {
    next(error);
  }
};

// Update folder
exports.updateFolder = async (req, res, next) => {
  try {
    const { folderId } = req.params;
    const { error, value } = validateFolderUpdate(req.body);
    
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const updateData = value;

    // Check if folder exists
    const folder = await Folder.findOne({ _id: folderId, userId });
    if (!folder) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found',
      });
    }

    // Check if trying to update name and it conflicts
    if (updateData.name && updateData.name !== folder.name) {
      const existingFolder = await Folder.findOne({ 
        userId, 
        name: updateData.name,
        _id: { $ne: folderId }
      });
      if (existingFolder) {
        return res.status(409).json({
          success: false,
          message: 'Folder with this name already exists',
        });
      }
    }

    // Prevent updating default folder's isDefault flag
    if (folder.isDefault && updateData.hasOwnProperty('isDefault') && !updateData.isDefault) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove default flag from default folder',
      });
    }

    // Update folder
    const updatedFolder = await Folder.findByIdAndUpdate(
      folderId,
      { $set: updateData },
      { new: true }
    ).lean();

    res.status(200).json({
      success: true,
      message: 'Folder updated successfully',
      data: { folder: updatedFolder },
    });
  } catch (error) {
    next(error);
  }
};

// Delete folder
exports.deleteFolder = async (req, res, next) => {
  try {
    const { folderId } = req.params;
    const userId = req.user.id;

    const folder = await Folder.findOne({ _id: folderId, userId });
    if (!folder) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found',
      });
    }

    // Prevent deleting default folder
    if (folder.isDefault) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete default folder',
      });
    }

    // Get count of favorites that will be moved
    const favoritesCount = await Favorite.countDocuments({ folderId });

    // Delete folder (middleware will handle moving favorites)
    await folder.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Folder deleted successfully',
      data: {
        movedFavoritesCount: favoritesCount
      },
    });
  } catch (error) {
    next(error);
  }
};

// Search folders
exports.searchFolders = async (req, res, next) => {
  try {
    const { error, value } = validateFolderSearch(req.query);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { query, limit, includeEmpty } = value;

    // Build search query
    const searchQuery = {
      userId,
      $or: [
        { name: { $regex: query, $options: 'i' } },
        { description: { $regex: query, $options: 'i' } },
        { 'metadata.tags': { $in: [new RegExp(query, 'i')] } }
      ]
    };

    if (!includeEmpty) {
      searchQuery.itemCount = { $gt: 0 };
    }

    const folders = await Folder.find(searchQuery)
      .sort({ name: 1 })
      .limit(limit)
      .lean();

    res.status(200).json({
      success: true,
      data: {
        folders,
        searchQuery: query,
        totalFound: folders.length
      },
    });
  } catch (error) {
    next(error);
  }
};

// Reorder folders
exports.reorderFolders = async (req, res, next) => {
  try {
    const { error, value } = validateFolderReorder(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const userId = req.user.id;
    const { folderOrders } = value;

    // Verify all folders belong to user
    const folderIds = folderOrders.map(item => item.folderId);
    const folders = await Folder.find({
      _id: { $in: folderIds },
      userId
    });

    if (folders.length !== folderIds.length) {
      return res.status(404).json({
        success: false,
        message: 'Some folders not found',
      });
    }

    // Update sort orders
    const updatePromises = folderOrders.map(({ folderId, sortOrder }) =>
      Folder.findByIdAndUpdate(folderId, { $set: { sortOrder } })
    );

    await Promise.all(updatePromises);

    res.status(200).json({
      success: true,
      message: 'Folders reordered successfully',
      data: {
        updatedCount: folderOrders.length
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get folder statistics
exports.getFolderStats = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Get folder statistics
    const stats = await Folder.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          totalFolders: { $sum: 1 },
          totalItems: { $sum: '$itemCount' },
          avgItemsPerFolder: { $avg: '$itemCount' },
          publicFolders: {
            $sum: { $cond: ['$isPublic', 1, 0] }
          },
          privateFolders: {
            $sum: { $cond: ['$isPublic', 0, 1] }
          },
          categoryCounts: {
            $push: '$metadata.category'
          }
        }
      }
    ]);

    // Get category distribution
    const categoryStats = await Folder.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: '$metadata.category',
          count: { $sum: 1 },
          totalItems: { $sum: '$itemCount' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // Get most active folders
    const mostActiveFolders = await Folder.find({ userId })
      .sort({ itemCount: -1, 'metadata.lastAccessed': -1 })
      .limit(5)
      .select('name itemCount metadata.lastAccessed color icon')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        overview: stats[0] || {
          totalFolders: 0,
          totalItems: 0,
          avgItemsPerFolder: 0,
          publicFolders: 0,
          privateFolders: 0
        },
        categoryDistribution: categoryStats,
        mostActiveFolders
      },
    });
  } catch (error) {
    next(error);
  }
};

// Duplicate folder
exports.duplicateFolder = async (req, res, next) => {
  try {
    const { folderId } = req.params;
    const userId = req.user.id;
    const { name, copyFavorites = false } = req.body;

    // Find source folder
    const sourceFolder = await Folder.findOne({ _id: folderId, userId });
    if (!sourceFolder) {
      return res.status(404).json({
        success: false,
        message: 'Source folder not found',
      });
    }

    // Check if new name conflicts
    const newName = name || `${sourceFolder.name} (Copy)`;
    const existingFolder = await Folder.findOne({ userId, name: newName });
    if (existingFolder) {
      return res.status(409).json({
        success: false,
        message: 'Folder with this name already exists',
      });
    }

    // Create duplicate folder
    const duplicateFolder = new Folder({
      userId,
      name: newName,
      description: sourceFolder.description,
      color: sourceFolder.color,
      icon: sourceFolder.icon,
      isPublic: sourceFolder.isPublic,
      sortOrder: sourceFolder.sortOrder + 1,
      metadata: {
        ...sourceFolder.metadata,
        category: sourceFolder.metadata?.category || 'other'
      }
    });

    await duplicateFolder.save();

    // Copy favorites if requested
    let copiedFavoritesCount = 0;
    if (copyFavorites) {
      const sourceFavorites = await Favorite.find({ folderId, userId });
      
      const duplicateFavorites = sourceFavorites.map(fav => ({
        userId: fav.userId,
        businessId: fav.businessId,
        folderId: duplicateFolder._id,
        notes: fav.notes,
        tags: fav.tags,
        rating: fav.rating,
        isPrivate: fav.isPrivate,
        metadata: fav.metadata
      }));

      if (duplicateFavorites.length > 0) {
        await Favorite.insertMany(duplicateFavorites);
        copiedFavoritesCount = duplicateFavorites.length;
        
        // Update folder item count
        duplicateFolder.itemCount = copiedFavoritesCount;
        await duplicateFolder.save();
      }
    }

    res.status(201).json({
      success: true,
      message: 'Folder duplicated successfully',
      data: {
        folder: duplicateFolder,
        copiedFavoritesCount
      },
    });
  } catch (error) {
    next(error);
  }
}; 