import "./BenchmarkChart.css";

export default function BenchmarkChart() {
  return (
    <section class="benchmark" id="benchmark">
      <div class="container">
        <h2>Performance Comparison</h2>
        <p class="benchmark-subtitle">
          Parsing 100K rows (10 MB) on Apple M1 Pro. Higher is better.
        </p>

        <div class="benchmark-table">
          <table>
            <thead>
              <tr>
                <th>Library</th>
                <th>1K rows</th>
                <th>10K rows</th>
                <th>100K rows</th>
                <th>100K (wide)</th>
              </tr>
            </thead>
            <tbody>
              <tr class="highlight">
                <td>TurboCSV</td>
                <td>122.6 MB/s</td>
                <td>165.3 MB/s</td>
                <td>176.1 MB/s</td>
                <td>269.3 MB/s</td>
              </tr>
              <tr>
                <td>PapaParse</td>
                <td>84.0 MB/s</td>
                <td>109.3 MB/s</td>
                <td>112.0 MB/s</td>
                <td>224.6 MB/s</td>
              </tr>
              <tr>
                <td>csv-parse</td>
                <td>25.2 MB/s</td>
                <td>34.9 MB/s</td>
                <td>35.3 MB/s</td>
                <td>40.3 MB/s</td>
              </tr>
              <tr>
                <td>fast-csv</td>
                <td>24.8 MB/s</td>
                <td>28.7 MB/s</td>
                <td>30.2 MB/s</td>
                <td>38.1 MB/s</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p class="benchmark-note">
          Run the benchmark yourself: <code>bun run benchmark:compare</code>
        </p>
      </div>
    </section>
  );
}
