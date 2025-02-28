import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const port = process.env.PORT

const db = new pg.Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

db.connect();

let quiz = [];

db.query("SELECT * FROM fruits",(err, res)=>{
  if(err){
    console.log("query Error !!!", err.stack);
  }else{
    quiz = res.rows;
  }
  db.end();
});

let totalCorrect = 0;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

let currentQuestion = {};
const active = true;
// GET home page
app.get("/", async (req, res) => {
  totalCorrect = 0;
  await nextQuestion();
  // console.log(currentQuestion);
  res.render("index.ejs", { 
    question: currentQuestion,
    quiz : active
  });
});

// POST a new post
app.post("/submit", (req, res) => {
  let answer = req.body.answer.trim();
  let isCorrect = false;
  if (currentQuestion.fruit_color.toLowerCase() === answer.toLowerCase()) {
    totalCorrect++;
    console.log("Total Score : ",totalCorrect);
    isCorrect = true;
    nextQuestion();
    res.render("index.ejs", {
      question: currentQuestion,
      wasCorrect: isCorrect,
      totalScore: totalCorrect,
      quiz : active
    });
  }
  else{
    res.render("index.ejs",{
      question: currentQuestion,
      totalScore: totalCorrect,
    });
  }
});

async function nextQuestion() {
  const randomFruit = quiz[Math.floor(Math.random() * quiz.length)];

  currentQuestion = randomFruit;
  console.log(currentQuestion);
}

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
