import Hero from "../components/Hero";
import BenchmarkChart from "../components/BenchmarkChart";
import Features from "../components/Features";
import CodeExample from "../components/CodeExample";
import Footer from "../components/Footer";

export default function Home() {
  return (
    <>
      <Hero />
      <BenchmarkChart />
      <Features />
      <CodeExample />
      <Footer />
    </>
  );
}
