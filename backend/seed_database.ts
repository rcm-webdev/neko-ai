import {ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings} from "@langchain/google-genai";
import {StructuredOutputParser} from "@langchain/core/output_parsers";
import {MongoClient} from "mongodb";
import {MongoDBAtlasVectorSearch} from "@langchain/mongodb";
import {z} from "zod";
import dotenv from "dotenv/config";


const client = new MongoClient(process.env.MONGO_URI as string);

const llm = new ChatGoogleGenerativeAI({
    model: "gemini-1.5-flash",
    temperature: 0.7,
    apiKey: process.env.GOOGLE_API_KEY,
});

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
    users_reviews: z.array(
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

async function setupDatabaseandCollection(): Promise<void> {
    console.log("Setting up database and collection...");
    const db = client.db("inventory_database");
    const collections = await db.listCollections({name: "items"}).toArray();

    if(collections.length === 0){
        await db.createCollection("items");
        console.log("Created 'items' collection in 'inventory_database' database");
    } else {
        console.log("'items' collection already exists in 'inventory_database' database");
    }
}

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
    console.log('creating vector search index')
    await collection.createSearchIndex(vectorSearchIdx);
    console.log("Vector search index created successfully");

 } catch(error){
    console.error("Error creating vector search index:", error);
 }
}