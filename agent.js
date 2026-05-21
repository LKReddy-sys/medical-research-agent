import { GoogleGenAI } from '@google/genai';
import nodemailer from 'nodemailer';
import axios from 'axios';
import 'dotenv/config';
import http from 'http';

// Initialize the Gemini API client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// 1. Fetch newly published research from PubMed API
async function fetchRecentResearch() {
    // Looks for papers from the past 1 day matching high impact global journals
    const searchTerm = '("The Lancet"[Journal] OR "New England Journal of Medicine"[Journal] OR "JAMA"[Journal] OR "Nature Medicine"[Journal]) AND ("2026"[Date - Publication] : "3000"[Date - Publication])';
    const pubMedUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pmc&term=${encodeURIComponent(searchTerm)}&reldate=1&datetype=pdat&retmode=json&retmax=15`;

    try {
        const searchRes = await axios.get(pubMedUrl);
        const idList = searchRes.data.esearchresult.idlist;
        if (!idList || idList.length === 0) return [];

        // Fetch details and titles for those IDs
        const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pmc&id=${idList.join(',')}&retmode=json`;
        const summaryRes = await axios.get(fetchUrl);
        
        return Object.keys(summaryRes.data.result)
            .filter(key => key !== 'uids')
            .map(key => ({
                title: summaryRes.data.result[key].title,
                journal: summaryRes.data.result[key].source,
                authors: summaryRes.data.result[key].authors ? summaryRes.data.result[key].authors.map(a => a.name).join(', ') : 'Unknown Authors',
                url: `https://pmc.ncbi.nlm.nih.gov/articles/PMC${key}/`
            }));
    } catch (error) {
        console.error("Error fetching data from PubMed:", error);
        return [];
    }
}

// 2. Use Gemini to filter and construct an elegant HTML digest
async function generateDigest(papers) {
    if (papers.length === 0) {
        return "<h3>Medical Digest</h3><p>No new papers were published in the target journals over the last 24 hours.</p>";
    }

    const rawTextData = JSON.stringify(papers, null, 2);
    
    const systemInstruction = `
        You are an expert clinical research screening agent. Review the provided raw list of recent publications.
        Filter out structural announcements or non-clinical errata. For real medical studies, construct a beautifully formatted HTML update.
        For each study, display:
        1. The title (as a clickable link using its URL)
        2. A 2-sentence executive summary highlighting clinical significance or discovery.
        3. The publishing journal name in bold.
        Use clean inline HTML styling suited for email reading (dark gray text, clear margins, clean spacing).
    `;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', 
            contents: `Analyze these recent publications and generate my brief digest:\n\n${rawTextData}`,
            config: {
                systemInstruction: systemInstruction,
                temperature: 0.1 
            }
        });

        return response.text;
    } catch (error) {
        console.error("Gemini Generation Error:", error);
        return null;
    }
}

// 3. Email the digested briefing via Gmail
async function sendEmailNotification(htmlContent) {
    let transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASS,
        },
    });

    let mailOptions = {
        from: `"Gemini Medical Agent" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `Daily Medical Breakthrough Digest - ${new Date().toLocaleDateString()}`,
        html: htmlContent,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log("Success! Email digest sent successfully.");
    } catch (error) {
        console.error("Email Delivery Error:", error);
    }
}

// Orchestrator function
async function runAgent() {
    console.log("Agent tracking active. Scraping PubMed...");
    const rawPapers = await fetchRecentResearch();
    console.log(`Discovered ${rawPapers.length} candidate papers. Processing with AI...`);
    
    const digest = await generateDigest(rawPapers);
    if (digest) {
        console.log("Digest ready. Dispatched to system mailing network...");
        await sendEmailNotification(digest);
    }
}

runAgent();
// Keeps the free Render Web Service happy by answering ping requests
http.createServer((req, res) => {
    if (req.url === '/trigger') {
        runAgent(); // Runs your agent manually when pinged!
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Agent triggered successfully.');
    } else {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Medical Agent is online.');
    }
}).listen(process.env.PORT || 3000);
