export interface PubMedSearchResult {
  count: number;
  idList: string[];
}

export async function searchPubMedIds(query: string, limit: number = 5): Promise<string[]> {
  try {
    // We add common medical filters to ensure high-quality clinical outcomes
    const augmentedQuery = `(${query}) AND (clinical trial[ptyp] OR meta-analysis[ptyp] OR guideline[ptyp]) AND ("last 5 years"[PDat])`;
    
    console.log(`[PUBMED] Searching PubMed for: ${augmentedQuery}`);
    
    const params = new URLSearchParams({
      db: "pubmed",
      term: augmentedQuery,
      retmode: "json",
      retmax: limit.toString(),
      sort: "date"
    });

    const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`PubMed API ESearch responded with status: ${res.status}`);
    }

    const data = await res.json();
    return data.esearchresult?.idlist || [];
  } catch (error) {
    console.error("[PUBMED] Error searching PubMed IDs:", error);
    return [];
  }
}

export async function fetchPubMedAbstracts(ids: string[]): Promise<string> {
  if (!ids || ids.length === 0) return "";
  
  try {
    console.log(`[PUBMED] Fetching abstracts for IDs: ${ids.join(",")}`);
    
    const params = new URLSearchParams({
      db: "pubmed",
      id: ids.join(","),
      retmode: "text",
      rettype: "abstract"
    });

    const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`PubMed API EFetch responded with status: ${res.status}`);
    }

    const text = await res.text();
    return text;
  } catch (error) {
    console.error("[PUBMED] Error fetching typical abstracts:", error);
    return "";
  }
}
