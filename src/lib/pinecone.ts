import { Pinecone, PineconeRecord } from "@pinecone-database/pinecone";
import { DownloadFromS3 } from "./s3-server";
import { PDFLoader } from "langchain/document_loaders/fs/pdf";
import md5 from "md5";
import {
  Document,
  RecursiveCharacterTextSplitter,
} from "@pinecone-database/doc-splitter";
import { getEmbeddings } from "./embeddings";
import { Vector } from "@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch";
import { convertToAscii } from "./utils";

export const pc = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  });
const index = pc.index('reports');
type PDFPage = {
  pageContent: string;
  metadata: {
    loc: { pageNumber: number };
  };
};
export async function LoadS3IntoPinecone(fileKey: string){
    //1. Get PDF
    console.log('Downloading file from S3')
    const file_name=await DownloadFromS3(fileKey);
    if(!file_name){
      throw new Error('Not download');
    }
    const loader = new PDFLoader(file_name);
    const pages = (await loader.load()) as PDFPage[];

    //2. split and segment pdf
    //pages = Array(13)
    const documents = await Promise.all(pages.map(prepareDocument));
    
    //3. vectorize and embed individual docs
    const vectors = await Promise.all(documents.flat().map(embedDocument))
    //upload to pinecone
    const namespace = index.namespace(convertToAscii(fileKey));
    console.log('Uploading to Pinecone')
    await namespace.upsert(vectors);
    // return pages;

    // const client = await getPineconeClient();
    // const pineconeIndex = await client.index("chatpdf");
    // const sd = pineconeIndex.namespace(convertToAscii(fileKey));
  
    // console.log("inserting vectors into pinecone");
    // await namespace.upsert(vectors);
  
    return documents[0];
}

async function embedDocument(doc: Document) {
  try {
    const embeddings = await getEmbeddings(doc.pageContent);
    const hash = md5(doc.pageContent);
    return {
      id: hash,
      values: embeddings,
      metadata: {
        text: doc.metadata.text,
        pageNumber: doc.metadata.pageNumber,
      } ,
    }as PineconeRecord;
  } catch (error) {
    console.log("error embedding document", error);
    throw error;
  }
}


export const truncateStringByBytes = (str: string, bytes: number) => {
  const enc = new TextEncoder();
  return new TextDecoder("utf-8").decode(enc.encode(str).slice(0, bytes));
};


async function prepareDocument(page: PDFPage) {
  let { pageContent, metadata } = page;
  pageContent = pageContent.replace(/\n/g, "");
  // split the docs
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 3000,

  });
  const docs = await splitter.splitDocuments([
    new Document({
      pageContent,
      metadata: {
        pageNumber: metadata.loc.pageNumber,
        text: truncateStringByBytes(pageContent, 100),
      },
    }),
  ]);
  console.log(docs)
  return docs;
}


