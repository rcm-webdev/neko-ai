import dotenv from "dotenv/config"
import express, { Express, Request, Response} from "express";
import {MongoClient} from "mongodb";
import {callAgent} from "./agent";

const app: Express = express();

import cors from "cors";
app.use(cors());

app.use(express.json());

const client = new MongoClient(process.env.MONGO_URI as string);

async function startServer(){
    try {
        await client.connect();
        await client.db("admin").command({ping: 1});
        console.log("Connected to MongoDB");

        app.get("/", (req: Request, res:Response) =>{
            res.send("Langgraph Agent Server is running. You better catch it!")
        })

        app.post("/chat", async (req: Request, res:Response) => {
            const initialMessage = req.body.message;
            const threadId = Date.now().toString();
            console.log(initialMessage, threadId);
            try {
                const response = await callAgent(client, initialMessage, threadId);
                res.json({threadId, response})
            } catch (error) {
                console.error('Error starting conversation:', error);
                res.status(500).json({error: 'Failed to start conversation'});
            }
        })

    } catch (error) {
        console.error(error);
    }
}