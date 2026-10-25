import mongoose from 'mongoose';
import categoryModel from '../models/categoryModel.js';
import 'dotenv/config';
import { resolveMongoConnectionUri } from '../config/mongodb.js';
import { summarizeMongoUri } from '../utils/redact.js';

const seedCategories = async () => {
  try {
    // Connect to MongoDB using the same resolved connection string as the
    // backend (config/mongodb.js) — never log the raw URI (credentials).
    const { uri } = resolveMongoConnectionUri(process.env);
    console.log('🔌 Connecting to MongoDB:', summarizeMongoUri(uri));
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

    // Clear existing categories
    await categoryModel.deleteMany({});
    console.log('Cleared existing categories');

    // Define initial categories and subcategories
    const initialCategories = [
      {
        name: 'iPhone',
        description: 'Apple\'s flagship smartphones with cutting-edge technology',
        sortOrder: 1,
        subCategories: [
          { name: 'Pro', description: 'Professional-grade iPhones with advanced features', sortOrder: 1 },
          { name: 'Air', description: 'Lightweight and portable iPhone models', sortOrder: 2 },
          { name: 'Mini', description: 'Compact iPhone models for easy handling', sortOrder: 3 },
          { name: 'Standard', description: 'Standard iPhone models with essential features', sortOrder: 4 },
          { name: 'Max', description: 'Large-screen iPhone models with enhanced capabilities', sortOrder: 5 },
          { name: 'Ultra', description: 'Ultra-premium iPhone models with maximum features', sortOrder: 6 }
        ]
      },
      {
        name: 'iPad',
        description: 'Versatile tablets perfect for work and entertainment',
        sortOrder: 2,
        subCategories: [
          { name: 'Pro', description: 'Professional-grade iPads for creative work', sortOrder: 1 },
          { name: 'Air', description: 'Lightweight and powerful iPad models', sortOrder: 2 },
          { name: 'Mini', description: 'Compact iPad models for portability', sortOrder: 3 },
          { name: 'Standard', description: 'Standard iPad models for everyday use', sortOrder: 4 },
          { name: 'Max', description: 'Large-screen iPad models for enhanced productivity', sortOrder: 5 },
          { name: 'Ultra', description: 'Ultra-premium iPad models with maximum features', sortOrder: 6 }
        ]
      },
      {
        name: 'Mac',
        description: 'Powerful computers for professionals and enthusiasts',
        sortOrder: 3,
        subCategories: [
          { name: 'Pro', description: 'Professional-grade Mac computers', sortOrder: 1 },
          { name: 'Air', description: 'Lightweight and portable Mac models', sortOrder: 2 },
          { name: 'Mini', description: 'Compact Mac models for space efficiency', sortOrder: 3 },
          { name: 'Standard', description: 'Standard Mac models for everyday computing', sortOrder: 4 },
          { name: 'Max', description: 'High-performance Mac models with maximum power', sortOrder: 5 },
          { name: 'Ultra', description: 'Ultra-premium Mac models with cutting-edge features', sortOrder: 6 }
        ]
      },
      {
        name: 'Watch',
        description: 'Smartwatches that keep you connected and healthy',
        sortOrder: 4,
        subCategories: [
          { name: 'Pro', description: 'Professional-grade Apple Watch models', sortOrder: 1 },
          { name: 'Air', description: 'Lightweight and comfortable Apple Watch models', sortOrder: 2 },
          { name: 'Mini', description: 'Compact Apple Watch models for smaller wrists', sortOrder: 3 },
          { name: 'Standard', description: 'Standard Apple Watch models for everyday use', sortOrder: 4 },
          { name: 'Max', description: 'Large-screen Apple Watch models with enhanced features', sortOrder: 5 },
          { name: 'Ultra', description: 'Ultra-premium Apple Watch models with maximum features', sortOrder: 6 }
        ]
      },
      {
        name: 'AirPods',
        description: 'Wireless earbuds and headphones for immersive audio',
        sortOrder: 5,
        subCategories: [
          { name: 'Pro', description: 'Professional-grade AirPods with advanced audio', sortOrder: 1 },
          { name: 'Air', description: 'Lightweight and comfortable AirPods', sortOrder: 2 },
          { name: 'Mini', description: 'Compact AirPods for easy portability', sortOrder: 3 },
          { name: 'Standard', description: 'Standard AirPods for everyday listening', sortOrder: 4 },
          { name: 'Max', description: 'Large over-ear AirPods with premium audio', sortOrder: 5 },
          { name: 'Ultra', description: 'Ultra-premium AirPods with maximum audio quality', sortOrder: 6 }
        ]
      },
      {
        name: 'Accessories',
        description: 'Essential accessories to enhance your Apple experience',
        sortOrder: 6,
        subCategories: [
          { name: 'Pro', description: 'Professional-grade accessories for power users', sortOrder: 1 },
          { name: 'Air', description: 'Lightweight and portable accessories', sortOrder: 2 },
          { name: 'Mini', description: 'Compact accessories for space efficiency', sortOrder: 3 },
          { name: 'Standard', description: 'Standard accessories for everyday use', sortOrder: 4 },
          { name: 'Max', description: 'Large and premium accessories with enhanced features', sortOrder: 5 },
          { name: 'Ultra', description: 'Ultra-premium accessories with maximum quality', sortOrder: 6 }
        ]
      }
    ];

    // Insert categories
    const createdCategories = await categoryModel.insertMany(initialCategories);
    console.log(`Successfully seeded ${createdCategories.length} categories`);

    // Log the created categories
    createdCategories.forEach(category => {
      console.log(`- ${category.name}: ${category.subCategories.length} subcategories`);
    });

    console.log('Category seeding completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('Error seeding categories:', error);
    process.exit(1);
  }
};

// Run the seed function
seedCategories(); 