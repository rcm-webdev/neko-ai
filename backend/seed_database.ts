//populate database with test data using googles generative artificial intelligence (gemini)

import {ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings} from "@langchain/google-genai";
import {StructuredOutputParser} from "@langchain/core/output_parsers";
import {MongoClient} from "mongodb";
import {MongoDBAtlasVectorSearch} from "@langchain/mongodb";
//validation and typesafety
import {z} from "zod";
import dotenv from "dotenv/config";


const client = new MongoClient(process.env.MONGO_URI as string);

//generate synthetic data
const llm = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash",
    temperature: 0.7,
    apiKey: process.env.GOOGLE_API_KEY,
});

//define a schema using zod
const itemSchema = z.object({
    item_id: z.string(),
    item_name: z.string(),
    item_description: z.string(),
    brand: z.string(),
    manufacturer_address: z.object({
        street: z.string(),
        city: z.string(),
        state: z.string(),
        postal_code: z.string(),
        country: z.string(),
    }),
    prices: z.object({
        full_price: z.number(),
        sale_price: z.number(),
    }),
    categories: z.array(z.string()),
    user_reviews: z.array(
        z.object({
            review_date: z.string(),
            review_comment: z.string(),
            rating: z.number(),
        })
    ),
    notes: z.string().optional(),
});

type Item = z.infer<typeof itemSchema>;

const parser = StructuredOutputParser.fromZodSchema(z.array(itemSchema));

//create database and collections
async function setupDatabaseandCollection(): Promise<void> {
    console.log("Setting up database and collection...");
    const db = client.db("inventory_database");
    //create a collection called items and create that into an array
    const collections = await db.listCollections({name: "items"}).toArray();

    //determine if the items collection exists
    if(collections.length === 0){
        await db.createCollection("items");
        console.log("Created 'items' collection in 'inventory_database' database");
    } else {
        console.log("'items' collection already exists in 'inventory_database' database");
    }
}

//create vector index
async function createVectorSearchIndex(): Promise<void> {
 try{
    const db = client.db("inventory_database");
    const collection = db.collection("items");
    await collection.dropIndexes();
    const vectorSearchIdx = {
        name: "vector_index",
        type: "vectorSearch",
        definition: {
            fields: [
                {
                    "type": "vector",
                    "path": "embedding",
                    "numDimensions": 768,
                    "similarity": "cosine",
                }
            ]
        }   
    }
    console.log('creating vector search index...')
    await collection.createSearchIndex(vectorSearchIdx);
    console.log("Vector search index created successfully");

 } catch(error){
    console.error("Error creating vector search index:", error);
 }
}


async function generateSyntheticData(): Promise<Item[]> {
    // Create detailed prompt instructing AI to generate furniture store data
    const prompt = `You are a helpful assistant that generates furniture store item data. Generate 10 furniture store items. Each record should include the following fields: item_id, item_name, item_description, brand, manufacturer_address, prices, categories, user_reviews, notes. Ensure variety in the data and realistic values.
  
    ${parser.getFormatInstructions()}`  // Add format instructions from parser
  
    // Log progress to console
    console.log("Generating synthetic data...")
  
    // Send prompt to AI and get response
    const response = await llm.invoke(prompt)
    // Parse AI response into structured array of Item objects
    return parser.parse(response.content as string)
  }

  async function createItemSummary(item:Item): Promise<string>{
    return new Promise((resolve) => {
        const manufacturerDetails = `Made in ${item.manufacturer_address.country}`
        const categories = item.categories.join(", ")
        const userReviews = item.user_reviews.map((review) => `Rated ${review.rating} on ${review.review_date}: ${review.review_comment} `).join(" ")

         // Create basic item information string
        const basicInfo = `${item.item_name} ${item.item_description} from the brand ${item.brand}`

         // Format pricing information
        const price = `At full price it costs: ${item.prices.full_price} USD, On sale it costs: ${item.prices.sale_price} USD`
        // Get additional notes
        const notes = item.notes
        // Combine all information into comprehensive summary for vector search
    const summary = `${basicInfo}. Manufacturer: ${manufacturerDetails}. Categories: ${categories}. Reviews: ${userReviews}. Price: ${price}. Notes: ${notes}`

    // Resolve promise with complete summary
    resolve(summary)
    })

  }

  //seed database

  async function seedDatabase(): Promise<void>{
    try{
        await client.connect()
        await client.db("admin").command({ping:1})
        console.log('You have successfully connected to Mongodb')
        await setupDatabaseandCollection()
        await createVectorSearchIndex()

        const db = client.db('inventory_database')
        const collection = db.collection('items')

        await collection.deleteMany({})
        console.log('Cleared existing data from items collection')

        const syntheticData = await generateSyntheticData()

         // Process each item: create summary and prepare for vector storage
        const recordsWithSummaries = await Promise.all(
            syntheticData.map(async (record) => ({
                pageContent: await createItemSummary(record),
                metadata: {...record}

            }))
        )
        // Store each record with vector embeddings in MongoDB
        for (const record of recordsWithSummaries){
            await MongoDBAtlasVectorSearch.fromDocuments(
                [record],
                new GoogleGenerativeAIEmbeddings({
                    apiKey: process.env.GOOGLE_API_KEY,
                    // Google's standard embedding model (768 dimensions)
                    modelName: "text-embedding-004"
                }),
                {
                    collection,
                    indexName:'vector_index',
                    textKey:"embedding-text",
                    embeddingKey: "embedding"
                }
                )
            // Log progress for each successfully processed item
            console.log("Successfully processed & saved record:", record.metadata.item_id)
        }
        console.log('Database seeding completed')



    } catch(error){
        console.error('failed to seed database', error)
    } finally {
        await client.close()
    }
  }

  // Execute the database seeding function and handle any errors
seedDatabase().catch(console.error)