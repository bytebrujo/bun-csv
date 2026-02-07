import Hero from "../components/Hero";
import BenchmarkChart from "../components/BenchmarkChart";
import Features from "../components/Features";
import WhatsNew from "../components/WhatsNew";
import CodeExample from "../components/CodeExample";
import Footer from "../components/Footer";

export default function Home() {
  return (
    <>
      <Hero />
      <BenchmarkChart />
      <Features />
      <WhatsNew />
      <CodeExample />
      <Footer />
    </>
  );
}
